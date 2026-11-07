/**
 * Aplicador do Blueprint Autônomo do NexusCRMAgent.
 *
 * Salva e instancia todas as configurações extraídas:
 * - Identidade visual e marca (cores, logo, nome)
 * - Agente de IA com persona e regras conversacionais
 * - Funil de vendas (pipeline e etapas específicas)
 * - Base de conhecimento persistente com versionamento e metadados de arquivos/links
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import type { AutonomousExtractionOutput } from "./autonomous-types";

export interface AplicarBlueprintResult {
  ok: boolean;
  error?: string;
  detalhes?: {
    organizationId: string;
    agentId?: string;
    pipelineId?: string;
    knowledgeSourceId?: string;
    documentsCount: number;
  };
}

export async function aplicarBlueprintAutonomo(
  blueprint: AutonomousExtractionOutput,
  organizationId: string,
  userId: string,
): Promise<AplicarBlueprintResult> {
  const admin = createAdminClient();

  try {
    // 1. Atualizar Organização (Nome, Slug e Branding)
    const { data: currentOrg } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .single();

    const currentSettings = (currentOrg?.settings ?? {}) as Record<string, unknown>;
    const currentBranding = (currentSettings.branding ?? {}) as Record<string, unknown>;

    const updatedBranding = {
      ...currentBranding,
      app_name: blueprint.brand_identity.name,
      accent_hex: blueprint.brand_identity.accent_color,
      primary_color: blueprint.brand_identity.primary_color,
      secondary_color: blueprint.brand_identity.secondary_color,
      colors: blueprint.brand_identity.colors || [
        blueprint.brand_identity.primary_color,
        blueprint.brand_identity.secondary_color,
        blueprint.brand_identity.accent_color,
      ],
      font_primary: blueprint.brand_identity.font_primary || "Lato",
      font_secondary: blueprint.brand_identity.font_secondary || "Inter",
      typography_style: blueprint.brand_identity.typography_style,
      ...(blueprint.brand_identity.logo_url
        ? { logo_url: blueprint.brand_identity.logo_url }
        : {}),
    };

    const updatedSettings = {
      ...currentSettings,
      branding: updatedBranding,
      niche: blueprint.niche,
    };

    const { error: orgErr } = await admin
      .from("organizations")
      .update({
        display_name: blueprint.brand_identity.name,
        slug: blueprint.brand_identity.slug,
        settings: updatedSettings,
      })
      .eq("id", organizationId);

    if (orgErr) throw new Error(`Erro ao atualizar organização: ${orgErr.message}`);

    // Invalida cache da org para atualização imediata
    invalidarOrg(organizationId);

    // 2. Atualizar ou Criar o Agente de IA Atendente
    let agentId: string | undefined;
    const { data: existingAgent } = await admin
      .from("ai_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();

    const agentPrompt = montarPromptDoAgente(blueprint);

    if (existingAgent) {
      agentId = existingAgent.id;
      await admin
        .from("ai_agents")
        .update({
          name: `${blueprint.brand_identity.name} Atendente`,
          description: `Atendente inteligente treinado para ${blueprint.brand_identity.name}`,
          model: "gemini-3.5-flash",
          is_active: true,
        })
        .eq("id", agentId);
    } else {
      const { data: newAgent } = await admin
        .from("ai_agents")
        .insert({
          organization_id: organizationId,
          name: `${blueprint.brand_identity.name} Atendente`,
          description: `Atendente inteligente treinado para ${blueprint.brand_identity.name}`,
          model: "gemini-3.5-flash",
          is_active: true,
        })
        .select("id")
        .single();
      agentId = newAgent?.id;
    }

    // 3. Configurar ou Atualizar Versão do Agente de IA com o Prompt e Instruções
    if (agentId) {
      const { data: cred } = await admin
        .from("ai_provider_credentials")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const { data: maxVer } = await admin
        .from("ai_agent_versions")
        .select("version_number")
        .eq("agent_id", agentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      await admin.from("ai_agent_versions").insert({
        agent_id: agentId,
        version_number: nextVersion,
        system_prompt: agentPrompt,
        provider: "google",
        model: "gemini-3.5-flash",
        temperature: 0.3,
        status: "published",
        created_by: userId,
        ...(cred?.id ? { credential_id: cred.id } : {}),
      });
    }

    // 4. Configurar Funil de Vendas (CRM Pipeline e Estágios)
    let pipelineId: string | undefined;
    const { data: existingPipe } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();

    if (existingPipe) {
      pipelineId = existingPipe.id;
    } else {
      const { data: newPipe } = await admin
        .from("crm_pipelines")
        .insert({
          organization_id: organizationId,
          name: "Funil Comercial",
          is_default: true,
        })
        .select("id")
        .single();
      pipelineId = newPipe?.id;
    }

    if (pipelineId && blueprint.sales_funnel.stages.length > 0) {
      // Deleta estágios antigos daquele funil se for primeira inicialização
      await admin.from("crm_stages").delete().eq("pipeline_id", pipelineId);

      const stagesToInsert = blueprint.sales_funnel.stages.map((st, idx) => ({
        pipeline_id: pipelineId,
        organization_id: organizationId,
        name: st.name,
        slug: st.slug || `etapa-${idx + 1}`,
        description: st.description,
        position: idx,
        is_won: Boolean(st.is_won),
        is_lost: Boolean(st.is_lost),
      }));

      await admin.from("crm_stages").insert(stagesToInsert);
    }

    // 5. Configurar Repositório Persistente de Documentos e Base de Conhecimento
    let knowledgeSourceId: string | undefined;
    const { data: existingSource } = await admin
      .from("ai_knowledge_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_type", "documento")
      .limit(1)
      .maybeSingle();

    const sourceMetadata = {
      master_markdown: blueprint.master_knowledge_markdown,
      persistent_documents: blueprint.persistent_documents,
      last_updated: new Date().toISOString(),
      source: "autonomous_onboarding_assistant",
      niche: blueprint.niche,
    };

    if (existingSource) {
      knowledgeSourceId = existingSource.id;
      await admin
        .from("ai_knowledge_sources")
        .update({
          name: "Base de Conhecimento Central",
          source_metadata: sourceMetadata,
          status: "ready",
          is_active: true,
        })
        .eq("id", knowledgeSourceId);
    } else {
      const { data: newSource } = await admin
        .from("ai_knowledge_sources")
        .insert({
          organization_id: organizationId,
          agent_id: agentId,
          name: "Base de Conhecimento Central",
          source_type: "documento",
          source_metadata: sourceMetadata,
          status: "ready",
          is_active: true,
        })
        .select("id")
        .single();
      knowledgeSourceId = newSource?.id;
    }

    // Criar versão do Knowledge Base com os documentos
    if (knowledgeSourceId) {
      await admin.from("ai_knowledge_versions").insert({
        organization_id: organizationId,
        knowledge_source_id: knowledgeSourceId,
        version_number: 1,
        description: "Versão inicial extraída pelo Assistente Autônomo",
        is_active: true,
        status: "ready",
        activated_by: userId,
        sources_snapshot: blueprint.persistent_documents,
      });

      // Se tiver FAQs extraídas, insere no FAQ index
      if (blueprint.objections_and_faqs.faqs.length > 0) {
        await admin.from("ai_faq_items").delete().eq("knowledge_source_id", knowledgeSourceId);

        const faqsToInsert = blueprint.objections_and_faqs.faqs.map((f) => ({
          organization_id: organizationId,
          knowledge_source_id: knowledgeSourceId,
          question: f.question,
          answer: f.answer,
          is_active: true,
        }));
        await admin.from("ai_faq_items").insert(faqsToInsert);
      }
    }

    // 6. Auditoria de conclusão de configuração autônoma
    await audit({
      action: "onboarding.completed",
      actorUserId: userId,
      organizationId,
      resourceType: "organization",
      resourceId: organizationId,
      metadata: {
        brand_name: blueprint.brand_identity.name,
        slug: blueprint.brand_identity.slug,
        documents_count: blueprint.persistent_documents.length,
        catalog_items: blueprint.catalog.length,
        stages_count: blueprint.sales_funnel.stages.length,
      },
    });

    return {
      ok: true,
      detalhes: {
        organizationId,
        agentId,
        pipelineId,
        knowledgeSourceId,
        documentsCount: blueprint.persistent_documents.length,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erro desconhecido ao aplicar configurações.",
    };
  }
}

function montarPromptDoAgente(blueprint: AutonomousExtractionOutput): string {
  let prompt = `Você é o atendente de inteligência artificial oficial da empresa ${blueprint.brand_identity.name}.\n\n`;

  prompt += `## IDENTIDADE E TOM DE VOZ:\n`;
  prompt += `- Tom de voz: ${blueprint.brand_identity.tone_of_voice}\n`;
  prompt += `- Estilo de resposta: Sempre cordial, humano, conciso e natural para canais de mensagens rápidas (WhatsApp e Instagram Direct).\n`;
  prompt += `- Seja objetivo: Evite mensagens excessivamente longas. Responda em parágrafos curtos e objetivos.\n\n`;

  prompt += `## REGRAS DE ATENDIMENTO:\n`;
  prompt += `- Horário de funcionamento: ${blueprint.business_rules.operating_hours}\n`;
  prompt += `- Localização / Região atendida: ${blueprint.business_rules.coverage_or_address}\n`;
  prompt += `- Garantia e Cancelamento: ${blueprint.business_rules.warranty_and_refund}\n`;
  prompt += `- Desconto máximo permitido caso o cliente peça negociação: ${blueprint.business_rules.max_discount_percentage}%\n\n`;

  prompt += `## CATÁLOGO DE PRODUTOS E SERVIÇOS:\n`;
  blueprint.catalog.forEach((item) => {
    const valor = (item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    prompt += `- **${item.name}** (${item.category}): ${item.description}. Preço: ${valor}. Prazo: ${item.delivery_time}. Formas: ${item.payment_methods.join(", ")}.\n`;
  });

  if (blueprint.objections_and_faqs.objections.length > 0) {
    prompt += `\n## TRATAMENTO DE OBJEÇÕES:\n`;
    blueprint.objections_and_faqs.objections.forEach((obj) => {
      prompt += `- Quando o cliente disser "${obj.objection}": ${obj.rebuttal}\n`;
    });
  }

  prompt += `\n## QUANDO PASSAR PARA ATENDIMENTO HUMANO (HANDOFF):\n`;
  prompt += `- Transfira imediatamente quando o cliente solicitar falar com atendente humano ou utilizar palavras como: ${blueprint.human_handoff.trigger_keywords.join(", ")}.\n`;
  prompt += `- Sempre confirme com o cliente que um especialista da equipe assumirá o atendimento em instantes.\n`;

  return prompt;
}
