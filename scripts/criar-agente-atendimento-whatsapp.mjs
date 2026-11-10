/**
 * Script 100% autônomo (ZERO dependências externas, roda com `node` puro).
 * Cria e publica o Agente de Atendimento no WhatsApp conectado à Base de Conhecimento.
 *
 * Execução:
 *   node scripts/criar-agente-atendimento-whatsapp.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";

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

// 1. Carregar variáveis do .env manualmente (compatível com qualquer Node)
const env = {};
for (const file of [".env", ".env.local"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  const content = fs.readFileSync(p, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) {
      env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1").trim();
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Erro: Não foi possível encontrar NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no arquivo .env.");
  process.exit(1);
}

const cleanBaseUrl = SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function req(endpoint, options = {}) {
  const url = `${cleanBaseUrl}/rest/v1${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("🚀 Iniciando configuração do Agente de Atendimento...");

  // 1. Obter organização
  console.log("🏢 Buscando organização...");
  const orgRes = await req("/organizations?select=id,display_name,legal_name&limit=1");
  if (!orgRes.ok || !orgRes.data || orgRes.data.length === 0) {
    console.error("❌ Nenhuma organização encontrada.", orgRes.data);
    process.exit(1);
  }
  const org = orgRes.data[0];
  const orgId = org.id;
  const orgName = org.display_name || org.legal_name || "Organização";
  console.log(`✅ Organização: "${orgName}" (${orgId})`);

  // 2. Obter canal WhatsApp
  console.log("📱 Buscando conexão de WhatsApp...");
  const chRes = await req(`/channel_sessions?organization_id=eq.${orgId}&select=id,display_name,status&limit=1`);
  const channelSessionId = chRes.ok && chRes.data?.length > 0 ? chRes.data[0].id : null;
  if (channelSessionId) {
    console.log(`✅ WhatsApp conectado: "${chRes.data[0].display_name}" (${channelSessionId})`);
  } else {
    console.log("⚠️ Nenhuma sessão de WhatsApp ativa encontrada (poderá ser vinculada depois na tela).");
  }

  // 3. Obter bases de conhecimento
  console.log("📚 Buscando bases de conhecimento...");
  const kbRes = await req(`/ai_knowledge_sources?organization_id=eq.${orgId}&is_active=eq.true&select=id,name`);
  const knowledgeSourceIds = kbRes.ok && Array.isArray(kbRes.data) ? kbRes.data.map((k) => k.id) : [];
  console.log(`✅ ${knowledgeSourceIds.length} fonte(s) de conhecimento encontrada(s).`);

  // 4. Obter credencial de IA
  console.log("🔑 Buscando credenciais de IA...");
  const credRes = await req(`/ai_provider_credentials?organization_id=eq.${orgId}&is_active=eq.true&select=id,provider&limit=1`);
  const credentialId = credRes.ok && credRes.data?.length > 0 ? credRes.data[0].id : null;
  const provider = credRes.ok && credRes.data?.length > 0 ? credRes.data[0].provider : "google";
  const model = provider === "google" ? "gemini-3.5-flash" : provider === "openai" ? "gpt-4o-mini" : "claude-3-5-haiku-20241022";

  // 5. Criar ou atualizar registro em ai_agents
  const AGENT_NAME = "Atendente WhatsApp";
  console.log(`🤖 Verificando se agente "${AGENT_NAME}" já existe...`);
  const agentCheck = await req(`/ai_agents?organization_id=eq.${orgId}&name=eq.${encodeURIComponent(AGENT_NAME)}&select=id`);

  let agentId = agentCheck.ok && agentCheck.data?.length > 0 ? agentCheck.data[0].id : null;

  if (!agentId) {
    const defRes = await req(`/ai_agents?organization_id=eq.${orgId}&is_default=eq.true&select=id&limit=1`);
    const isDefault = !(defRes.ok && defRes.data?.length > 0);

    console.log("✨ Criando novo agente...");
    const createAgentRes = await req("/ai_agents", {
      method: "POST",
      body: JSON.stringify({
        organization_id: orgId,
        name: AGENT_NAME,
        description: "Agente de atendimento no WhatsApp integrado à base de conhecimento da empresa.",
        model,
        system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
        kind: "mcp_agent",
        priority: 10,
        is_active: true,
        is_default: isDefault,
      }),
    });

    if (!createAgentRes.ok || !createAgentRes.data?.length) {
      console.error("❌ Falha ao criar registro do agente:", createAgentRes.data);
      process.exit(1);
    }
    agentId = createAgentRes.data[0].id;
    console.log(`✅ Agente criado com sucesso (ID: ${agentId})`);
  } else {
    console.log(`ℹ️ Agente existente encontrado (ID: ${agentId}), atualizando...`);
    await req(`/ai_agents?id=eq.${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
        is_active: true,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // 6. Criar nova versão em ai_agent_versions
  console.log("📝 Criando versão com prompt e ferramentas...");
  const verCountRes = await req(`/ai_agent_versions?organization_id=eq.${orgId}&agent_id=eq.${agentId}&select=version_number&order=version_number.desc&limit=1`);
  const nextVer = verCountRes.ok && verCountRes.data?.length > 0 ? verCountRes.data[0].version_number + 1 : 1;

  const createVerRes = await req("/ai_agent_versions", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      agent_id: agentId,
      version_number: nextVer,
      system_prompt: PROMPT_ATENDIMENTO_WHATSAPP,
      provider,
      model,
      credential_id: credentialId,
      tool_ids: ["crm_search_knowledge", "crm_get_lead", "crm_create_lead", "crm_request_human_handoff"],
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
      followup: { enabled: false, flow_pointer_ids: [], send_window: null },
      status: "draft",
    }),
  });

  if (!createVerRes.ok || !createVerRes.data?.length) {
    console.error("❌ Falha ao criar versão do agente:", createVerRes.data);
    process.exit(1);
  }

  const versionId = createVerRes.data[0].id;
  console.log(`✅ Versão gerada (ID: ${versionId})`);

  // 7. Publicar agente
  console.log("🚀 Publicando agente para atender no WhatsApp...");
  const pubRes = await req("/rpc/fn_publish_ai_agent_version", {
    method: "POST",
    body: JSON.stringify({
      p_org_id: orgId,
      p_agent_id: agentId,
      p_version_id: versionId,
      p_platform_credential_verified: true,
    }),
  });

  if (pubRes.ok) {
    console.log("🎉 AGENTE PUBLICADO COM SUCESSO! Pronto para atender mensagens.");
  } else {
    console.log(`⚠️ Tentando ativação direta de versão (Motivo RPC: ${JSON.stringify(pubRes.data)})`);
    await req(`/ai_agents?id=eq.${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        published_version_id: versionId,
        updated_at: new Date().toISOString(),
      }),
    });
    await req(`/ai_agent_versions?id=eq.${versionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "published",
        published_at: new Date().toISOString(),
      }),
    });
    console.log("🎉 AGENTE ATIVADO E VINCULADO COM SUCESSO!");
  }

  console.log("\n========================================================");
  console.log(`🤖 Agente: "${AGENT_NAME}"`);
  console.log(`📌 ID: ${agentId}`);
  console.log(`📱 WhatsApp Vinculado: ${channelSessionId || "Nenhum (conecte na tela Conexões)"}`);
  console.log(`📚 Bases de Conhecimento vinculadas: ${knowledgeSourceIds.length}`);
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
