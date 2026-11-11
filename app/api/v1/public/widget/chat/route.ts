/**
 * POST /api/v1/public/widget/chat
 *
 * Endpoint público para o Web Chat Widget instalado em sites de clientes.
 * Processa mensagens com busca na Base de Conhecimento (RAG) da organização
 * e responde através do agente de IA configurado.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";

import { createAdminClient } from "@/lib/supabase/admin";
import { buscarConhecimento } from "@/lib/ai/knowledge/busca";
import { resolveLanguageModel } from "@/lib/ai/gateway";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

const widgetChatSchema = z.object({
  org: z.string().trim().min(1).max(120),
  agent_id: z.string().uuid().optional(),
  session_id: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous-ip";

  // Rate limit por IP (ex: 30 mensagens por minuto para evitar abusos)
  const rateLimitKey = `rate:widget:ip:${ip}`;
  const rateLimitResult = await checkRateLimit(rateLimitKey, 30, 60);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limit_exceeded",
          message: "Muitas mensagens enviadas em pouco tempo. Aguarde um instante.",
        },
      },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Formato JSON inválido." } },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const parsed = widgetChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Mensagem ou parâmetros inválidos.",
          details: parsed.error.flatten(),
        },
      },
      { status: 422, headers: CORS_HEADERS },
    );
  }

  const { org: orgIdentifier, agent_id, message, history } = parsed.data;
  const admin = createAdminClient();

  // 1. Resolve a organização (por slug ou por ID)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdentifier);
  const orgQuery = admin
    .from("organizations")
    .select("id, name, slug, phone, settings")
    .limit(1);

  const { data: orgData, error: orgErr } = isUuid
    ? await orgQuery.eq("id", orgIdentifier).maybeSingle()
    : await orgQuery.eq("slug", orgIdentifier).maybeSingle();

  if (orgErr || !orgData) {
    return NextResponse.json(
      { error: { code: "org_not_found", message: "Organização não encontrada ou inativa." } },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const orgId = orgData.id;
  const orgName = orgData.name;
  const orgPhone = orgData.phone;

  // 2. Resolve o agente e persona
  let agentName = "Atendente Virtual";
  let agentPrompt =
    `Você é o assistente virtual oficial da empresa "${orgName}".\n` +
    "Seu papel é atender visitantes, tirar dúvidas sobre produtos e serviços com precisão, qualificar oportunidades e ser simpático e ágil.\n" +
    "Responda sempre em português claro e acolhedor, baseando-se estritamente nas informações da empresa fornecidas no contexto.\n" +
    "Caso não saiba ou a informação não esteja no contexto, seja sincero e ofereça a opção de falar com um especialista humano no WhatsApp.";

  const { data: agents } = await admin
    .from("ai_agents")
    .select("id, name, config")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  const activeAgent = agent_id
    ? agents?.find((a) => a.id === agent_id)
    : agents?.[0];

  if (activeAgent?.name) {
    agentName = activeAgent.name;
  }
  const configPrompt = (activeAgent?.config as { system_prompt?: string } | undefined)?.system_prompt;
  if (configPrompt?.trim()) {
    agentPrompt = configPrompt.trim();
  }

  // 3. Busca RAG (Base de Conhecimento)
  let contextoConhecimento = "";
  const citations: Array<{ source: string; text: string }> = [];

  try {
    // Busca materiais prontos da organização
    const { data: sources } = await admin
      .from("ai_knowledge_sources")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .in("status", ["ready", "indexed"]);

    const sourceIds = (sources || []).map((s) => s.id);

    if (sourceIds.length > 0) {
      const searchRes = await buscarConhecimento(admin, {
        organizationId: orgId,
        knowledgeSourceIds: sourceIds,
        pergunta: message,
        limiar: 0.35,
        quantidade: 5,
        autor: "ai",
      });

      if (searchRes.trechos && searchRes.trechos.length > 0) {
        contextoConhecimento = searchRes.trechos
          .map((t, idx) => `[Documento ${idx + 1}: ${t.source_name || "Material da empresa"}]\n${t.content}`)
          .join("\n\n---\n\n");

        for (const t of searchRes.trechos) {
          citations.push({
            source: t.source_name || "Base de conhecimento",
            text: t.content.slice(0, 200),
          });
        }
      }
    }
  } catch (err) {
    console.warn("[widget-chat] RAG retrieval error (prosseguindo sem contexto extra):", err);
  }

  // 4. Monta mensagens e invoca o modelo de IA
  const systemInstruction =
    `${agentPrompt}\n\n` +
    `Contexto da empresa (${orgName}):\n` +
    (contextoConhecimento
      ? `INFORMAÇÕES OFICIAIS DO ACERVO:\n${contextoConhecimento}\n\n`
      : "Nenhum documento específico encontrado para esta pergunta. Responda cordialmente com base geral.\n\n") +
    (orgPhone ? `Contato WhatsApp oficial para suporte humano: ${orgPhone}\n` : "");

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemInstruction },
  ];

  // Adiciona histórico recente
  for (const h of history.slice(-6)) {
    chatMessages.push({
      role: h.role,
      content: h.content,
    });
  }

  // Adiciona a mensagem atual
  chatMessages.push({ role: "user", content: message });

  // Seleciona o modelo (Gemini como primário, OpenRouter/Llama como secundário)
  let model = resolveLanguageModel("google/gemini-2.0-flash");
  if (!model && env.OPENROUTER_API_KEY) {
    model = resolveLanguageModel("meta-llama/llama-3.3-70b-instruct");
  }
  if (!model && env.ANTHROPIC_API_KEY) {
    model = resolveLanguageModel("anthropic/claude-haiku-4-5");
  }
  if (!model && env.OPENAI_API_KEY) {
    model = resolveLanguageModel("openai/gpt-4o-mini");
  }

  if (!model) {
    return NextResponse.json(
      {
        reply:
          "Olá! Agradecemos o seu contato. Nosso sistema de inteligência artificial está temporariamente em manutenção técnica. Por favor, entre em contato diretamente pelo nosso WhatsApp para que possamos lhe atender com prioridade!",
        whatsapp_phone: orgPhone,
      },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  try {
    const aiResponse = await generateText({
      model,
      messages: chatMessages,
      temperature: 0.4,
      maxTokens: 600,
    });

    return NextResponse.json(
      {
        reply: aiResponse.text,
        agent_name: agentName,
        citations: citations.length > 0 ? citations : undefined,
        whatsapp_phone: orgPhone,
        request_id: requestId,
      },
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (error: unknown) {
    console.error("[widget-chat] Erro ao gerar resposta do modelo:", error);
    return NextResponse.json(
      {
        reply:
          "Tive uma pequena oscilação na conexão com a inteligência artificial. Poderia repetir a sua dúvida por gentileza?",
        error_details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}

