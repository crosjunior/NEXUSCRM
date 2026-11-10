/**
 * Aplicador do Blueprint Autônomo do NexusCRMAgent.
 *
 * Salva e instancia todas as configurações extraídas:
 * - Identidade visual e marca (cores, logo, nome)
 * - Agente de IA com persona, regras conversacionais, versão publicada e vinculada aos canais
 * - Funil de vendas (pipeline e etapas específicas)
 * - Base de conhecimento persistente com versionamento, arquivo no Storage e metadados de arquivos/links
 */

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import { normalizarHex } from "@/lib/branding/rampa";
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
      .select("settings, slug")
      .eq("id", organizationId)
      .single();

    const currentSettings = (currentOrg?.settings ?? {}) as Record<string, unknown>;
    const currentBranding = (currentSettings.branding ?? {}) as Record<string, unknown>;

    const accentHex = normalizarHex(blueprint.brand_identity.accent_color || "#001b4a");
    const accentDarkHex = normalizarHex(
      blueprint.brand_identity.primary_color || blueprint.brand_identity.accent_color || "#001b4a",
    );

    let logoPath: string | null = null;
    if (blueprint.brand_identity.logo_url) {
      if (blueprint.brand_identity.logo_url.startsWith("data:image/")) {
        try {
          const match = blueprint.brand_identity.logo_url.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
          if (match && match[2]) {
            const ext = match[1] === "svg+xml" ? "svg" : match[1] === "jpeg" ? "jpg" : match[1] || "png";
            const buffer = Buffer.from(match[2], "base64");
            const logoStoragePath = `${organizationId}/logo.${ext}`;
            await admin.storage
              .from("brand-logos")
              .upload(logoStoragePath, buffer, {
                contentType: `image/${match[1]}`,
                upsert: true,
              });
            logoPath = logoStoragePath;
          }
        } catch (e) {
          console.warn("[autonomous-apply] aviso ao fazer upload do logo:", e);
        }
      } else if (!blueprint.brand_identity.logo_url.startsWith("http")) {
        logoPath = blueprint.brand_identity.logo_url;
      }
    }

    const updatedBranding = {
      ...currentBranding,
      app_name: blueprint.brand_identity.name,
      accent_hex: accentHex,
      accent_dark_hex: accentDarkHex,
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
      ...(logoPath ? { logo_path: logoPath, logo_url: logoPath } : blueprint.brand_identity.logo_url ? { logo_url: blueprint.brand_identity.logo_url } : {}),
      updated_at: new Date().toISOString(),
    };

    const updatedSettings = {
      ...currentSettings,
      branding: updatedBranding,
      niche: blueprint.niche,
    };

    // Previne conflito de slug único com outra organização
    const { data: existingSlug } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", blueprint.brand_identity.slug)
      .neq("id", organizationId)
      .maybeSingle();

    const safeSlug = existingSlug
      ? `${blueprint.brand_identity.slug}-${organizationId.slice(0, 4)}`
      : blueprint.brand_identity.slug;

    const { error: orgErr } = await admin
      .from("organizations")
      .update({
        display_name: blueprint.brand_identity.name,
        slug: safeSlug,
        settings: updatedSettings,
      })
      .eq("id", organizationId);

    if (orgErr) throw new Error(`Erro ao atualizar organização: ${orgErr.message}`);

    // Invalida cache da org para atualização imediata na sessão
    invalidarOrg(organizationId);

    // 2. Configurar Funil de Vendas (CRM Pipeline e Estágios)
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
      await admin
        .from("crm_stages")
        .delete()
        .eq("pipeline_id", pipelineId)
        .eq("organization_id", organizationId);

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

    // 3. Configurar Repositório Persistente de Documentos e Base de Conhecimento
    let knowledgeSourceId: string | undefined;
    const { data: existingSource } = await admin
      .from("ai_knowledge_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_type", "documento")
      .limit(1)
      .maybeSingle();

    // Faz upload do markdown mestre para o bucket de conhecimento
    let blobPath: string | null = null;
    if (blueprint.master_knowledge_markdown) {
      blobPath = `${organizationId}/${randomUUID()}.md`;
      const { error: uploadBlobErr } = await admin.storage
        .from("ai-knowledge-sources")
        .upload(blobPath, Buffer.from(blueprint.master_knowledge_markdown, "utf8"), {
          contentType: "text/markdown",
          upsert: true,
        });

      if (uploadBlobErr) {
        console.warn("[autonomous-apply] aviso no upload da base de conhecimento:", uploadBlobErr.message);
      }
    }

    const sourceMetadata = {
      master_markdown: blueprint.master_knowledge_markdown,
      persistent_documents: blueprint.persistent_documents,
      blob_path: blobPath,
      ext: "md",
      origem: "onboarding_autonomo",
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
        .eq("id", knowledgeSourceId)
        .eq("organization_id", organizationId);
    } else {
      const { data: newSource } = await admin
        .from("ai_knowledge_sources")
        .insert({
          organization_id: organizationId,
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

    if (knowledgeSourceId) {
      // Cria versão do Knowledge Base
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
        await admin
          .from("ai_faq_items")
          .delete()
          .eq("knowledge_source_id", knowledgeSourceId)
          .eq("organization_id", organizationId);

        const faqsToInsert = blueprint.objections_and_faqs.faqs.map((f, idx) => ({
          organization_id: organizationId,
          knowledge_source_id: knowledgeSourceId,
          question: f.question,
          answer: f.answer,
          position: idx,
          is_active: true,
        }));
        await admin.from("ai_faq_items").insert(faqsToInsert);
      }

      // Emite evento para o RAG indexer preparar os trechos de imediato
      await admin.from("event_log").insert({
        organization_id: organizationId,
        event_type: "knowledge_source.updated",
        entity_kind: "ai_knowledge_source",
        entity_id: knowledgeSourceId,
        payload: { knowledge_source_id: knowledgeSourceId },
        metadata: { source: "autonomous_apply" },
      });
    }

    // 4. Buscar canais de atendimento conectados (WhatsApp / Instagram)
    const { data: channelSessions } = await admin
      .from("channel_sessions")
      .select("id, status, provider, metadata")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    const activeSession =
      channelSessions?.find((c) => c.status === "connected" || c.status === "active") ??
      channelSessions?.[0];
    const channelSessionId = activeSession?.id ?? null;

    // 5. Atualizar ou Criar o Agente de IA Atendente
    let agentId: string | undefined;
    const { data: existingAgent } = await admin
      .from("ai_agents")
      .select("id, is_default, published_version_id")
      .eq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();

    const { data: defaultAgent } = await admin
      .from("ai_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    const isDefault = existingAgent?.is_default ?? (!defaultAgent || defaultAgent.id === existingAgent?.id);
    const agentPrompt = montarPromptDoAgente(blueprint);

    if (existingAgent) {
      agentId = existingAgent.id;
      await admin
        .from("ai_agents")
        .update({
          name: `${blueprint.brand_identity.name} Atendente`,
          description: `Atendente inteligente treinado para ${blueprint.brand_identity.name}`,
          system_prompt: agentPrompt,
          model: "google/gemini-2.5-flash",
          is_active: true,
          paused_at: null,
          archived_at: null,
        })
        .eq("id", agentId)
        .eq("organization_id", organizationId);
    } else {
      const { data: newAgent, error: agentErr } = await admin
        .from("ai_agents")
        .insert({
          organization_id: organizationId,
          name: `${blueprint.brand_identity.name} Atendente`,
          description: `Atendente inteligente treinado para ${blueprint.brand_identity.name}`,
          system_prompt: agentPrompt,
          model: "google/gemini-2.5-flash",
          is_active: true,
          is_default: isDefault,
          paused_at: null,
          archived_at: null,
        })
        .select("id")
        .single();

      if (agentErr) throw new Error(`Erro ao criar agente de IA: ${agentErr.message}`);
      agentId = newAgent?.id;
    }

    // 6. Configurar e Publicar Versão do Agente de IA com Prompt, Base e Canal
    if (agentId) {
      const { data: cred } = await admin
        .from("ai_provider_credentials")
        .select("id, provider")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const { data: maxVer } = await admin
        .from("ai_agent_versions")
        .select("version_number")
        .eq("agent_id", agentId)
        .eq("organization_id", organizationId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      const { data: newVer, error: verErr } = await admin
        .from("ai_agent_versions")
        .insert({
          organization_id: organizationId,
          agent_id: agentId,
          version_number: nextVersion,
          system_prompt: agentPrompt,
          provider: cred?.provider || "google",
          model: "gemini-2.5-flash",
          credential_id: cred?.id ?? null,
          tool_ids: [
            "crm_get_contact",
            "crm_update_lead_stage",
            "crm_create_task",
            "crm_schedule_meeting",
            "crm_request_human_handoff",
          ],
          trigger_config: undefined,
          channel_session_id: channelSessionId,
          max_steps: 10,
          token_budget: 50000,
          cost_budget_cents: 50,
          history_message_window: 20,
          history_token_window: 8000,
          handoff_keywords: blueprint.human_handoff.trigger_keywords,
          handoff_tool_enabled: true,
          handoff_legal_enabled: true,
          proposal_ai_draft_enabled: true,
          cases_enabled: false,
          split_messages: false,
          split_max_chars: 600,
          inbound_debounce_ms: null,
          followup: {
            enabled: false,
            flow_pointer_ids: [],
            send_window: null,
          },
          operator_enabled: false,
          operator_model: null,
          operator_tool_ids: [],
          pipeline_ids: pipelineId ? [pipelineId] : [],
          knowledge_source_ids: knowledgeSourceId ? [knowledgeSourceId] : [],
          status: "published",
          created_by: userId,
        })
        .select("id")
        .single();

      if (verErr) throw new Error(`Erro ao criar versão do agente: ${verErr.message}`);

      // Publica atomicamente no ai_agents
      if (newVer?.id) {
        await admin
          .from("ai_agents")
          .update({
            published_version_id: newVer.id,
            system_prompt: agentPrompt,
            is_active: true,
            paused_at: null,
            archived_at: null,
          })
          .eq("id", agentId)
          .eq("organization_id", organizationId);
      }

      // Vincula canais de comunicação ao agente
      if (channelSessions && channelSessions.length > 0) {
        for (const cs of channelSessions) {
          const meta = (cs.metadata ?? {}) as Record<string, unknown>;
          await admin
            .from("channel_sessions")
            .update({
              metadata: {
                ...meta,
                agent_id: agentId,
              },
            })
            .eq("id", cs.id)
            .eq("organization_id", organizationId);
        }
      }

      // Ativa o agente nas conversas em andamento da organização
      await admin
        .from("conversations")
        .update({
          active_ai_agent_id: agentId,
        })
        .eq("organization_id", organizationId)
        .is("active_ai_agent_id", null);
    }

    // 7. Auditoria de conclusão de configuração autônoma
    await audit({
      action: "onboarding.completed",
      actorUserId: userId,
      organizationId,
      resourceType: "organization",
      resourceId: organizationId,
      metadata: {
        brand_name: blueprint.brand_identity.name,
        slug: safeSlug,
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
  prompt += `- Nome da Empresa: ${blueprint.brand_identity.name}\n`;
  prompt += `- Tom de voz: ${blueprint.brand_identity.tone_of_voice}\n`;
  prompt += `- Estilo de resposta: Sempre cordial, humano, conciso e natural para canais de mensagens rápidas (WhatsApp e Instagram Direct).\n`;
  prompt += `- Seja objetivo: Evite mensagens excessivamente longas. Responda em parágrafos curtos e objetivos.\n\n`;

  prompt += `## REGRAS DE ATENDIMENTO:\n`;
  prompt += `- Horário de funcionamento: ${blueprint.business_rules.operating_hours}\n`;
  prompt += `- Localização / Região atendida: ${blueprint.business_rules.coverage_or_address}\n`;
  prompt += `- Garantia e Cancelamento: ${blueprint.business_rules.warranty_and_refund}\n`;
  prompt += `- Desconto máximo permitido caso o cliente peça negociação: ${blueprint.business_rules.max_discount_percentage}%\n\n`;

  if (blueprint.catalog.length > 0) {
    prompt += `## CATÁLOGO DE PRODUTOS E SERVIÇOS:\n`;
    blueprint.catalog.forEach((item) => {
      const valor = (item.price_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      prompt += `- **${item.name}** (${item.category}): ${item.description}. Preço: ${valor}. Prazo: ${item.delivery_time}. Formas: ${item.payment_methods.join(", ")}.\n`;
    });
    prompt += `\n`;
  }

  if (blueprint.objections_and_faqs.faqs.length > 0) {
    prompt += `## PERGUNTAS FREQUENTES (FAQ):\n`;
    blueprint.objections_and_faqs.faqs.forEach((faq) => {
      prompt += `- **Pergunta:** ${faq.question}\n  **Resposta:** ${faq.answer}\n`;
    });
    prompt += `\n`;
  }

  if (blueprint.objections_and_faqs.objections.length > 0) {
    prompt += `## TRATAMENTO DE OBJEÇÕES:\n`;
    blueprint.objections_and_faqs.objections.forEach((obj) => {
      prompt += `- Quando o cliente disser "${obj.objection}": ${obj.rebuttal}\n`;
    });
    prompt += `\n`;
  }

  if (blueprint.master_knowledge_markdown) {
    prompt += `## BASE DE CONHECIMENTO COMPLEMENTAR:\n`;
    prompt += `${blueprint.master_knowledge_markdown.slice(0, 4000)}\n\n`;
  }

  prompt += `## QUANDO PASSAR PARA ATENDIMENTO HUMANO (HANDOFF):\n`;
  prompt += `- Transfira imediatamente quando o cliente solicitar falar com atendente humano ou utilizar palavras como: ${blueprint.human_handoff.trigger_keywords.join(", ")}.\n`;
  prompt += `- Sempre confirme com o cliente que um especialista da equipe assumirá o atendimento em instantes.\n`;

  return prompt;
}
