/**
 * Script CLI para criar e publicar um Agente de Atendimento no WhatsApp
 * com Base de Conhecimento (RAG) e regras de acolhimento.
 *
 * Execução:
 *   npx tsx scripts/criar-agente-atendimento-whatsapp.ts [org_id]
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { VALID_TOOL_IDS } from "@/lib/mcp/tools/catalog";

const PROMPT_ATENDIMENTO_WHATSAPP = `# Quem você é
Você é o assistente virtual oficial de atendimento da empresa.
Seu tom de voz é acolhedor, profissional, objetivo e humano, conversando em português brasileiro fluente e em mensagens curtas adequadas para o WhatsApp (evite blocos longos de texto).

# Como iniciar a conversa (Primeiro Contato)
Sempre que um cliente enviar uma mensagem nova:
1. Cumprimente com simpatia de acordo com o momento (Olá! Tudo bem?).
2. Pergunte educadamente o nome do cliente caso ainda não saiba.
3. Pergunte de forma prestativa como você pode ajudar no dia de hoje.

# Uso da Base de Conhecimento
- Você tem acesso aos documentos e regras da empresa. Sempre consulte a base de conhecimento antes de responder sobre serviços, produtos, horários, preços, endereços e procedimentos.
- Se a informação estiver na base de conhecimento, explique de forma clara e direta.
- Se a resposta NÃO estiver nos materiais da empresa, nunca invente ou adivinhe informações. Diga educadamente que vai verificar ou ofereça transferir para a equipe humana.

# Regras e Limites
- Nunca prometa descontos ou prazos fora dos materiais oficiais.
- Mantenha a conversa focada em resolver a dúvida ou necessidade do cliente.
- Se o cliente pedir para falar com uma pessoa real ou se o caso exigir análise manual, transfira cordialmente para um atendente humano.`;

async function main() {
  const admin = createAdminClient();
  const orgArg = process.argv[2];

  console.log("🔍 Buscando organização...");
  let orgId = orgArg;

  if (!orgId) {
    const { data: orgs, error: orgErr } = await admin
      .from("organizations")
      .select("id, name")
      .limit(1);

    if (orgErr || !orgs || orgs.length === 0) {
      console.error("❌ Nenhuma organização encontrada no banco de dados.");
      process.exit(1);
    }
    orgId = orgs[0]!.id;
    console.log(`🏢 Organização selecionada: "${orgs[0]!.name}" (${orgId})`);
  }

  // 1. Localizar sessão de canal WhatsApp
  console.log("📱 Buscando conexão de WhatsApp...");
  const { data: channels } = await admin
    .from("channel_sessions")
    .select("id, display_name, status")
    .eq("organization_id", orgId);

  const channelSessionId = channels && channels.length > 0 ? channels[0]!.id : null;
  if (channelSessionId) {
    console.log(`✅ WhatsApp vinculado: "${channels![0]!.display_name}" (${channelSessionId})`);
  } else {
    console.log("⚠️ Nenhuma sessão de WhatsApp encontrada. O agente será criado sem canal fixo (pode ser vinculado na tela).");
  }

  // 2. Localizar fontes de conhecimento (Knowledge Base)
  console.log("📚 Buscando fontes de conhecimento ativas...");
  const { data: kbSources } = await admin
    .from("ai_knowledge_sources")
    .select("id, title")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  const knowledgeSourceIds = kbSources?.map((k) => k.id) ?? [];
  console.log(`✅ ${knowledgeSourceIds.length} fonte(s) de conhecimento encontrada(s).`);

  // 3. Localizar credencial ativa de IA (OpenAI / Google / Anthropic)
  const { data: creds } = await admin
    .from("ai_provider_credentials_safe")
    .select("id, provider")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1);

  const credentialId = creds && creds.length > 0 ? creds[0]!.id : null;
  const provider = creds && creds.length > 0 ? creds[0]!.provider : "google";
  const model = provider === "google" ? "gemini-3.5-flash" : provider === "openai" ? "gpt-4o-mini" : "claude-3-5-haiku-20241022";

  // Ferramentas permitidas
  const recommendedTools = [
    "crm_search_knowledge",
    "crm_get_lead",
    "crm_create_lead",
    "crm_request_human_handoff",
  ];
  const validSet = new Set<string>(VALID_TOOL_IDS as readonly string[]);
  const finalTools = recommendedTools.filter((t) => validSet.has(t));

  // 4. Criar ou atualizar o Agente
  const AGENT_NAME = "Atendente WhatsApp";
  console.log(`🤖 Criando agente "${AGENT_NAME}"...`);

  const { data: existingAgent } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", AGENT_NAME)
    .maybeSingle();

  let agentId = existingAgent?.id;

  if (!agentId) {
    const { data: newAgent, error: createErr } = await admin
      .from("ai_agents")
      .insert({
        organization_id: orgId,
        name: AGENT_NAME,
        description: "Agente de atendimento no WhatsApp integrado à base de conhecimento da empresa.",
        model,
        system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
        kind: "mcp_agent",
        priority: 10,
        is_active: true,
        is_default: true,
      })
      .select("id")
      .single();

    if (createErr || !newAgent) {
      console.error("❌ Erro ao criar agente:", createErr?.message);
      process.exit(1);
    }
    agentId = newAgent.id;
    console.log(`✅ Registro do agente criado: ${agentId}`);
  } else {
    console.log(`ℹ️ Agente já existia (${agentId}), atualizando prompt...`);
    await admin
      .from("ai_agents")
      .update({
        system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agentId);
  }

  // 5. Criar versão do agente
  console.log("📝 Criando versão draft v1 do agente...");
  const { data: versionRow, error: versionErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      version_number: 1,
      system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
      provider,
      model,
      credential_id: credentialId,
      tool_ids: finalTools,
      channel_session_id: channelSessionId,
      knowledge_source_ids: knowledgeSourceIds,
      max_steps: 10,
      token_budget: 10000,
      cost_budget_cents: 100,
      history_message_window: 20,
      history_token_window: 8000,
      handoff_keywords: ["falar com humano", "atendente humano", "pessoa real", "atendente"],
      handoff_tool_enabled: true,
      handoff_legal_enabled: true,
      proposal_ai_draft_enabled: true,
      cases_enabled: true,
      split_messages: true,
      split_max_chars: 280,
      inbound_debounce_ms: 3000,
      followup: {
        enabled: false,
        flow_pointer_ids: [],
        send_window: null,
      },
    })
    .select("id")
    .single();

  if (versionErr || !versionRow) {
    console.error("❌ Erro ao criar versão:", versionErr?.message);
    process.exit(1);
  }

  console.log(`✅ Versão criada: ${versionRow.id}`);

  // 6. Publicar versão
  console.log("🚀 Publicando agente...");
  const pubResult = await publishAgentVersion(admin, {
    orgId,
    agentId,
    versionId: versionRow.id,
  });

  if (pubResult.ok) {
    console.log("🎉 Agente publicado com sucesso e pronto para atender no WhatsApp!");
  } else {
    console.log(`⚠️ Versão salva em rascunho. Motivo para não auto-publicar: ${pubResult.message}`);
    console.log("👉 Você pode revisar e clicar em 'Publicar' diretamente em IA › Agentes no painel web.");
  }

  console.log("\n========================================================");
  console.log(`Agente: "${AGENT_NAME}"`);
  console.log(`ID: ${agentId}`);
  console.log(`WhatsApp Conectado: ${channelSessionId ?? "Nenhum (vincule na tela)"}`);
  console.log(`Bases de Conhecimento vinculadas: ${knowledgeSourceIds.length}`);
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("❌ Falha:", err);
  process.exit(1);
});
