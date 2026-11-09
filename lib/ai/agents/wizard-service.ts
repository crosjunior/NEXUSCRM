/**
 * Serviço de Orquestração do Assistente Inteligente de Criação de Agentes (Wizard)
 *
 * Conduz a criação, geração via Gemini e ativação atômica de agentes de IA
 * para WhatsApp e Instagram, aproveitando o contexto corporativo já cadastrado no CRM.
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { VALID_TOOL_IDS } from "@/lib/mcp/tools/catalogo";

export interface WizardOrganizationContext {
  organizationId: string;
  organizationName: string;
  niche: string;
  knowledgeSources: { id: string; title: string; description: string | null }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  channels: { id: string; name: string; channel_type: string; status: string }[];
  googleCredentialId: string | null;
  brandIdentity: {
    commercial_name?: string;
    tone_of_voice?: string;
    target_audience?: string;
    colors?: string[];
  } | null;
}

export interface AgentWizardInput {
  agentName: string;
  channelSessionId: string | null;
  targetAudience: string;
  primaryObjective: "sales_qualification" | "support_faq" | "scheduling" | "hybrid" | "custom";
  objectiveDescription: string;
  toneOfVoice: "consultative" | "direct" | "friendly" | "formal" | "custom";
  customTone?: string;
  useEmojis: "moderate" | "none" | "expressive";
  knowledgeSourceIds: string[];
  pipelineIds: string[];
  capabilities: {
    searchKnowledge: boolean;
    manageLeads: boolean;
    moveStages: boolean;
    scheduleAppointments: boolean;
    humanHandoff: boolean;
  };
  guardrails: {
    splitMessages: boolean;
    declareAiAssistant: boolean;
    protectPricing: boolean;
    handoffKeywords: string[];
  };
}

export interface AgentWizardGeneratedBlueprint {
  systemPrompt: string;
  suggestedTools: string[];
  handoffKeywords: string[];
  summary: {
    role: string;
    approach: string;
    keyRules: string[];
  };
}

async function obterChaveGoogle(organizationId: string): Promise<string | null> {
  const admin = createAdminClient();

  // 1. Tenta credencial cadastrada para a organização
  const { data: cred } = await admin
    .from("ai_provider_credentials")
    .select("api_key_encrypted, api_key_iv, api_key_tag, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", "google")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (cred?.api_key_encrypted && cred?.api_key_iv && cred?.api_key_tag) {
    try {
      const decrypted = decryptKey({
        ciphertext: byteaToBuffer(cred.api_key_encrypted),
        iv: byteaToBuffer(cred.api_key_iv),
        tag: byteaToBuffer(cred.api_key_tag),
      });
      if (decrypted) return decrypted;
    } catch {
      // Degrada para variáveis de ambiente
    }
  }

  // 2. Fallback para variáveis de ambiente do servidor
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    null
  );
}

/**
 * Carrega todo o contexto da organização para pré-preencher o assistente wizard
 */
export async function obterContextoOrganizacao(
  organizationId: string,
): Promise<WizardOrganizationContext> {
  const admin = createAdminClient();

  const [orgRes, kbRes, pipesRes, stagesRes, channelsRes, credsRes] = await Promise.all([
    admin.from("organizations").select("id, name, niche, settings").eq("id", organizationId).single(),
    admin
      .from("knowledge_sources")
      .select("id, title, description")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("pipelines")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("order_index", { ascending: true }),
    admin
      .from("pipeline_stages")
      .select("id, name, pipeline_id")
      .eq("organization_id", organizationId)
      .order("order_index", { ascending: true }),
    admin
      .from("channel_sessions")
      .select("id, name, channel_type, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("ai_provider_credentials_safe")
      .select("id, provider, label, is_active")
      .eq("organization_id", organizationId)
      .eq("provider", "google")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  const orgData = orgRes.data;
  const settings = (orgData?.settings as Record<string, unknown>) ?? {};
  const brand = (settings.brand_identity as Record<string, unknown>) ?? {};

  // Agrupa etapas por funil
  const stagesByPipe = new Map<string, { id: string; name: string }[]>();
  for (const stage of stagesRes.data ?? []) {
    const list = stagesByPipe.get(stage.pipeline_id) ?? [];
    list.push({ id: stage.id, name: stage.name });
    stagesByPipe.set(stage.pipeline_id, list);
  }

  const pipelines = (pipesRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: stagesByPipe.get(p.id) ?? [],
  }));

  return {
    organizationId,
    organizationName: orgData?.name ?? "Empresa",
    niche: orgData?.niche ?? "Comercial e Atendimento",
    knowledgeSources: (kbRes.data ?? []).map((k) => ({
      id: k.id,
      title: k.title,
      description: k.description,
    })),
    pipelines,
    channels: (channelsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name || "Canal WhatsApp/Instagram",
      channel_type: c.channel_type || "whatsapp",
      status: c.status,
    })),
    googleCredentialId: credsRes.data?.id ?? null,
    brandIdentity: {
      commercial_name: (brand.commercial_name as string) || orgData?.name,
      tone_of_voice: (brand.tone_of_voice as string) || undefined,
      target_audience: (brand.target_audience as string) || undefined,
      colors: Array.isArray(brand.colors) ? (brand.colors as string[]) : undefined,
    },
  };
}

/**
 * Gera via Gemini o prompt de sistema completo, ferramentas recomendadas e regras
 */
export async function gerarBlueprintComIA(
  organizationId: string,
  input: AgentWizardInput,
): Promise<AgentWizardGeneratedBlueprint> {
  const context = await obterContextoOrganizacao(organizationId);
  const apiKey = await obterChaveGoogle(organizationId);

  // Mapeia capacidades para ferramentas reais do catálogo
  const recommendedTools: string[] = [];
  if (input.capabilities.searchKnowledge && context.knowledgeSources.length > 0) {
    recommendedTools.push("crm_search_knowledge");
  }
  if (input.capabilities.manageLeads) {
    recommendedTools.push("crm_get_lead", "crm_create_lead");
  }
  if (input.capabilities.moveStages && context.pipelines.length > 0) {
    recommendedTools.push("crm_move_lead_stage");
  }
  if (input.capabilities.scheduleAppointments) {
    recommendedTools.push("calendar_list_appointments", "calendar_book_appointment");
  }
  if (input.capabilities.humanHandoff) {
    recommendedTools.push("crm_request_human_handoff");
  }

  const validSet = new Set<string>(VALID_TOOL_IDS as readonly string[]);
  const finalTools = recommendedTools.filter((t) => validSet.has(t));

  const promptSystemInfo = `Você é um Arquiteto Sênior de Agentes de IA Conversacional para WhatsApp e Instagram.
Gere um SYSTEM PROMPT de alto desempenho, altamente humanizado e profissional para o atendente virtual do cliente.

DADOS DA EMPRESA:
- Nome da Empresa: ${context.organizationName}
- Nicho: ${context.niche}
- Nome do Atendente Virtual: ${input.agentName}
- Canal de Atendimento: WhatsApp e Instagram
- Objetivo Principal: ${input.primaryObjective} (${input.objectiveDescription})
- Público-Alvo: ${input.targetAudience}
- Tom de Voz Escolhido: ${input.toneOfVoice === "custom" ? input.customTone : input.toneOfVoice}
- Uso de Emojis: ${input.useEmojis}
- Transparência de IA: ${input.guardrails.declareAiAssistant ? "Se perguntarem se é robô/IA, confirme com naturalidade e simpatia." : "Aja naturalmente como consultor da equipe."}
- Proteção de Valores: ${input.guardrails.protectPricing ? "NUNCA invente preços, descontos ou prazos não confirmados nos materiais." : "Apenas informe dados oficiais."}
- Ferramentas Disponíveis ao Agente: ${finalTools.join(", ")}
- Gatilhos de Transferência Humana: ${input.guardrails.handoffKeywords.join(", ")}

ESTRUTURA OBRIGATÓRIA DO SYSTEM PROMPT:
1. IDENTIDADE E PAPEL: Quem você é, em nome de quem você fala e seu propósito.
2. TOM DE VOZ E LINGUAGEM: Frases naturais, sem termos robóticos, sem introduções genéricas ("Olá! Como posso ajudar você hoje com excelência?"). Fale como um especialista humano atencioso no WhatsApp.
3. FLUXO DE ATENDIMENTO:
   - Passo 1: Acolhimento caloroso e identificação rápida da necessidade.
   - Passo 2: Qualificação consultiva (fazer 1 pergunta por vez, sem interrogatórios).
   - Passo 3: Apresentação de soluções baseada no conhecimento da empresa.
   - Passo 4: Próximo passo claro (agendar demonstração/visita, enviar proposta ou direcionar ao especialista).
4. REGRAS INVIOLÁVEIS (GUARDRAILS):
   - Nunca inventar fatos, preços ou condições não existentes na base.
   - Usar a ferramenta crm_search_knowledge para responder dúvidas específicas.
   - Chamar um consultor humano imediatamente se o lead pedir ou apresentar dúvida complexa fora do escopo.

Responda em formato JSON com a seguinte estrutura:
{
  "systemPrompt": "o texto completo do prompt do sistema em português",
  "summary": {
    "role": "resumo do papel em 1 frase",
    "approach": "resumo da abordagem em 1 frase",
    "keyRules": ["regra 1", "regra 2", "regra 3", "regra 4"]
  }
}`;

  if (apiKey) {
    const google = createGoogleGenerativeAI({ apiKey });
    const modelos = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

    for (const modelo of modelos) {
      try {
        const response = await generateText({
          model: google(modelo),
          prompt: promptSystemInfo,
        });

        const raw = response.text.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed.systemPrompt) {
          return {
            systemPrompt: parsed.systemPrompt,
            suggestedTools: finalTools,
            handoffKeywords: input.guardrails.handoffKeywords,
            summary: parsed.summary || {
              role: `Atendente consultivo da ${context.organizationName}`,
              approach: `Atendimento ágil, acolhedor e focado no público ${input.targetAudience}`,
              keyRules: [
                "Buscar respostas oficiais na base de conhecimento",
                "Fazer uma pergunta por vez de forma consultiva",
                "Transferir para a equipe humana quando solicitado",
              ],
            },
          };
        }
      } catch (err) {
        console.warn(`[wizard-service] Falha no modelo ${modelo}, tentando próximo...`, err);
      }
    }
  }

  // Fallback determinístico de alto padrão caso a IA externa não responda
  const fallbackPrompt = `Você é ${input.agentName}, consultor virtual da ${context.organizationName}.
Sua missão é atender leads e clientes via WhatsApp e Instagram com excelência, atenção e agilidade.

# IDENTIDADE E TOM DE VOZ
- Empresa: ${context.organizationName} (${context.niche})
- Público-Alvo: ${input.targetAudience}
- Tom: ${input.toneOfVoice === "custom" ? input.customTone : "Acolhedor, profissional e direto ao ponto"}
- Estilo: Respostas concisas e naturais, ideais para mensagens de WhatsApp (1 a 3 parágrafos curtos).

# OBJETIVO PRINCIPAL
${input.objectiveDescription || "Qualificar o interesse do lead, esclarecer dúvidas com base nas informações oficiais da empresa e conduzir para o fechamento ou agendamento."}

# DIRETRIZES DE ATENDIMENTO
1. Acolha com simpatia e chame o cliente pelo nome sempre que disponível.
2. Faça perguntas consultivas de forma pontual (evite mandar blocos com muitas perguntas).
3. Consulte as informações oficiais da empresa antes de responder sobre condições, produtos ou serviços.
4. Caso o cliente solicite contato humano ou tenha uma dúvida não coberta, utilize a ferramenta de transferência humana.
5. Seja transparente caso seja questionado se você é uma inteligência artificial.`;

  return {
    systemPrompt: fallbackPrompt,
    suggestedTools: finalTools,
    handoffKeywords: input.guardrails.handoffKeywords,
    summary: {
      role: `Consultor virtual da ${context.organizationName}`,
      approach: "Atendimento consultivo e humanizado no WhatsApp",
      keyRules: [
        "Consultar base de conhecimento",
        "Uma pergunta por vez",
        "Transferência humana proativa",
      ],
    },
  };
}

/**
 * Cria o agente, sua primeira versão (v1) e a publica atômica e imediatamente
 */
export async function salvarEPublicarAgenteWizard(params: {
  organizationId: string;
  userId: string;
  input: AgentWizardInput;
  blueprint: AgentWizardGeneratedBlueprint;
}): Promise<{ ok: true; agentId: string; versionId: string } | { ok: false; error: string }> {
  const { organizationId, userId, input, blueprint } = params;
  const admin = createAdminClient();
  const requestId = randomUUID();

  // 1. Obtém credencial do Google para associar à versão
  const { data: cred } = await admin
    .from("ai_provider_credentials_safe")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "google")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const credentialId = cred?.id ?? null;

  // 2. Insere na tabela ai_agents
  const { data: agentRow, error: agentErr } = await admin
    .from("ai_agents")
    .insert({
      organization_id: organizationId,
      name: input.agentName,
      description: input.objectiveDescription || `Agente de atendimento criado via assistente inteligente para ${input.targetAudience}`,
      model: "gemini-3.5-flash",
      system_prompt: blueprint.systemPrompt,
      kind: "mcp_agent",
      priority: 10,
      is_active: false,
      is_default: true,
      created_by: userId,
    })
    .select("id")
    .single();

  if (agentErr || !agentRow) {
    return { ok: false, error: agentErr?.message || "Erro ao criar agente" };
  }

  // 3. Insere a versão v1
  const { data: versionRow, error: versionErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: organizationId,
      agent_id: agentRow.id,
      version_number: 1,
      system_prompt: blueprint.systemPrompt,
      provider: "google",
      model: "gemini-3.5-flash",
      credential_id: credentialId,
      tool_ids: blueprint.suggestedTools,
      trigger_config: undefined,
      channel_session_id: input.channelSessionId,
      max_steps: 10,
      token_budget: 10000,
      cost_budget_cents: 100,
      history_message_window: 20,
      history_token_window: 8000,
      handoff_keywords: blueprint.handoffKeywords,
      handoff_tool_enabled: input.capabilities.humanHandoff,
      handoff_legal_enabled: true,
      proposal_ai_draft_enabled: true,
      cases_enabled: true,
      split_messages: input.guardrails.splitMessages,
      split_max_chars: 280,
      inbound_debounce_ms: 3000,
      followup: {
        enabled: false,
        flow_pointer_ids: [],
        send_window: null,
      },
      operator_enabled: false,
      operator_model: null,
      operator_tool_ids: [],
      pipeline_ids: input.pipelineIds,
      knowledge_source_ids: input.knowledgeSourceIds,
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();

  if (versionErr || !versionRow) {
    // Limpa agente se falhar a versão
    await admin
      .from("ai_agents")
      .delete()
      .eq("id", agentRow.id)
      .eq("organization_id", organizationId);
    return { ok: false, error: versionErr?.message || "Erro ao criar versão inicial" };
  }

  // 4. Publica a versão usando a função atômica fn_publish_ai_agent_version
  const publishResult = await publishAgentVersion(admin, {
    orgId: organizationId,
    agentId: agentRow.id,
    versionId: versionRow.id,
    quemPublicou: {
      actorUserId: userId,
      requestId,
    },
  });

  if (!publishResult.ok) {
    return { ok: false, error: publishResult.message || "Erro ao publicar versão do agente" };
  }

  // 5. Registra auditoria
  void audit({
    action: "ai_agent.created",
    actorUserId: userId,
    organizationId,
    resourceType: "ai_agent",
    resourceId: agentRow.id,
    requestId,
    metadata: {
      via_wizard: true,
      agent_name: input.agentName,
      tools: blueprint.suggestedTools,
    },
  });

  return {
    ok: true,
    agentId: agentRow.id,
    versionId: versionRow.id,
  };
}
