import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { fecharAvisoDePausaDoCanalArquivado } from "@/lib/channels/central-de-pausa";
import { resolveInstagramCreds } from "@/lib/channels/instagram/credentials";
import { buildAuthorizeUrl, listInstagramMedia } from "@/lib/channels/instagram/api";
import { getInstagramChannelSession } from "@/lib/channels/instagram/service";
import { SOCIAL_PROVIDER } from "@/lib/channels/social/catalog";
import type {
  InstagramFlowGraph,
  InstagramKeywordRule,
  InstagramMediaItem,
  InstagramRuleExecutionLog,
  InstagramRuleStats,
  InstagramTenantConfig,
} from "@/lib/channels/instagram/types";

export const dynamic = "force-dynamic";

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["start", "message", "input", "condition", "action", "delay", "ai"]),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.record(z.string(), z.unknown()),
});

const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().optional(),
  target: z.string(),
});

const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
});

const ruleStatsSchema = z.object({
  total_triggers: z.number().optional(),
  comments_count: z.number().optional(),
  public_replies_count: z.number().optional(),
  dms_sent_count: z.number().optional(),
  followers_count: z.number().optional(),
  non_followers_count: z.number().optional(),
  button_clicks_count: z.number().optional(),
  last_executed_at: z.string().nullable().optional(),
});

const ruleSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  mode: z.enum(["basic", "visual"]).optional(),
  type: z.enum(["comment_keyword", "story_mention", "dm_keyword"]),
  keywords: z.array(z.string()),
  match: z.enum(["contains", "exact"]),
  public_reply: z.string().nullable().optional(),
  dm_message: z.string().min(1),
  active: z.boolean(),
  media_id: z.string().nullable().optional(),
  media_caption_preview: z.string().nullable().optional(),
  media_thumbnail_url: z.string().nullable().optional(),
  media_product_type: z.string().nullable().optional(),
  media_permalink: z.string().nullable().optional(),
  is_permanent: z.boolean().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  flow_graph: flowGraphSchema.nullable().optional(),
  stats: ruleStatsSchema.nullable().optional(),
});

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_connect_url") }).strict(),
  z.object({ action: z.literal("set_agent"), agent_id: z.string().nullable() }).strict(),
  z.object({ action: z.literal("save_keywords"), rules: z.array(ruleSchema) }).strict(),
  z.object({ action: z.literal("clear_rule_logs"), rule_id: z.string().optional() }).strict(),
  z
    .object({
      action: z.literal("save_credentials"),
      credentials: z.object({
        app_id: z.string().optional(),
        app_secret: z.string().optional(),
        config_id: z.string().optional(),
        verify_token: z.string().optional(),
      }),
    })
    .strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
]);

function normalizeRule(
  raw: Record<string, unknown>,
  executions: InstagramRuleExecutionLog[],
): InstagramKeywordRule {
  const id = String(raw.id || `rule_${Date.now()}`);
  const rawType = (raw.type || raw.trigger_type || "comment_keyword") as InstagramKeywordRule["type"];
  const rawMatch = (raw.match || raw.match_type || "contains") as InstagramKeywordRule["match"];
  const rawMode = raw.mode === "visual" ? "visual" : "basic";
  const flowGraph =
    raw.flow_graph && typeof raw.flow_graph === "object"
      ? (raw.flow_graph as InstagramFlowGraph)
      : null;

  const rawStats =
    raw.stats && typeof raw.stats === "object" ? (raw.stats as Partial<InstagramRuleStats>) : null;
  const ruleLogs = executions.filter((e) => e.rule_id === id);

  const computedComments = ruleLogs.filter((e) => e.trigger_type === "comment_keyword").length;
  const computedPubReplies = ruleLogs.filter((e) => Boolean(e.public_reply_sent)).length;
  const computedDms = ruleLogs.filter((e) => Boolean(e.dm_sent)).length;
  const computedFollowers = ruleLogs.filter((e) => e.is_follower === true).length;
  const computedNonFollowers = ruleLogs.filter((e) => e.is_follower === false).length;
  const computedClicks = ruleLogs.filter((e) => e.trigger_type === "postback").length;
  const computedTriggers = ruleLogs.filter((e) => e.trigger_type !== "postback").length;

  const stats: InstagramRuleStats = {
    total_triggers: Math.max(rawStats?.total_triggers ?? 0, computedTriggers),
    comments_count: Math.max(rawStats?.comments_count ?? 0, computedComments),
    public_replies_count: Math.max(rawStats?.public_replies_count ?? 0, computedPubReplies),
    dms_sent_count: Math.max(rawStats?.dms_sent_count ?? 0, computedDms),
    followers_count: Math.max(rawStats?.followers_count ?? 0, computedFollowers),
    non_followers_count: Math.max(rawStats?.non_followers_count ?? 0, computedNonFollowers),
    button_clicks_count: Math.max(rawStats?.button_clicks_count ?? 0, computedClicks),
    last_executed_at:
      rawStats?.last_executed_at ?? (ruleLogs[0]?.executed_at ? ruleLogs[0].executed_at : null),
  };

  return {
    id,
    name: typeof raw.name === "string" ? raw.name : null,
    mode: rawMode,
    type:
      rawType === "comment_keyword" || rawType === "story_mention" || rawType === "dm_keyword"
        ? rawType
        : "comment_keyword",
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String) : [],
    match: rawMatch === "exact" ? "exact" : "contains",
    public_reply: typeof raw.public_reply === "string" ? raw.public_reply : null,
    dm_message: String(raw.dm_message || ""),
    active: raw.active !== false,
    media_id: typeof raw.media_id === "string" && raw.media_id ? raw.media_id : null,
    media_caption_preview:
      typeof raw.media_caption_preview === "string" ? raw.media_caption_preview : null,
    media_thumbnail_url:
      typeof raw.media_thumbnail_url === "string" ? raw.media_thumbnail_url : null,
    media_product_type:
      typeof raw.media_product_type === "string" ? raw.media_product_type : null,
    media_permalink: typeof raw.media_permalink === "string" ? raw.media_permalink : null,
    is_permanent: raw.is_permanent !== false,
    starts_at: typeof raw.starts_at === "string" && raw.starts_at ? raw.starts_at : null,
    ends_at: typeof raw.ends_at === "string" && raw.ends_at ? raw.ends_at : null,
    flow_graph: flowGraph,
    stats,
  };
}

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "instagram_channel" });
  if (!auth.ok) return auth.response;

  const orgId = auth.org.orgId;
  const db = createAdminClient();

  try {
    // 1. Busca a sessão do canal do Instagram desta organização
    const session = await getInstagramChannelSession(db, orgId);

    const metadata = (session?.metadata ?? {}) as Record<string, unknown>;
    const isDirectMeta = metadata.direct_meta === true;

    // 2. Busca lista de agentes de IA disponíveis na organização
    const { data: agents } = await db
      .from("ai_agents")
      .select("id, name, description, is_active")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    // 3. Resolve as credenciais (tenant ou fallback)
    const creds = await resolveInstagramCreds(db, orgId);

    const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    const webhookUrl = `${appUrl}/api/v1/webhooks/instagram`;

    const account =
      session && isDirectMeta
        ? {
            id: session.id,
            accountId: session.accountId,
            username:
              (metadata.username as string) ||
              session.display_name?.replace(/^Instagram · @/, "").replace(/^@/, "") ||
              "",
            name: (metadata.name as string) || "",
            profile_picture_url: (metadata.profile_picture_url as string) || null,
            status: session.status,
            connectedAt: session.created_at,
          }
        : null;

    // 4. Se a conta está conectada, busca os Posts, Reels e Stories recentes da Meta
    let mediaItems: InstagramMediaItem[] = [];
    if (account && session) {
      let token: string | null = null;
      if (session.meta_token_encrypted) {
        token = await decryptWebhookSecret(db, session.meta_token_encrypted as string);
      }
      if (!token && typeof metadata.access_token === "string") {
        token = metadata.access_token;
      }
      if (token && account.accountId) {
        try {
          mediaItems = await listInstagramMedia(creds, token, account.accountId);
        } catch {
          mediaItems = [];
        }
      }
    }

    const rawExecutions = Array.isArray(metadata.rule_executions)
      ? (metadata.rule_executions as InstagramRuleExecutionLog[])
      : [];

    const rawRules = Array.isArray(metadata.keyword_rules) ? metadata.keyword_rules : [];
    const normalizedRules = rawRules.map((r) =>
      normalizeRule((r ?? {}) as Record<string, unknown>, rawExecutions),
    );

    const mappedAgents = (agents ?? []).map((ag) => ({
      id: ag.id,
      name: ag.name,
      role: ag.description || "Atendente de IA",
      status: ag.is_active ? "published" : "paused",
    }));

    return ok({
      connected: Boolean(account),
      account,
      agent_id: (metadata.agent_id as string) || null,
      keyword_rules: normalizedRules,
      rule_executions: rawExecutions,
      media_items: mediaItems,
      available_agents: mappedAgents,
      webhook_url: webhookUrl,
      webhook_verify_token: creds.verifyToken,
      has_custom_credentials: false,
    });
  } catch (err) {
    return fail(
      "instagram_state_failed",
      err instanceof Error ? err.message : "Falha ao carregar estado do Instagram.",
      500,
      { requestId },
    );
  }
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "instagram_channel" });
  if (!auth.ok) return auth.response;

  const orgId = auth.org.orgId;
  const supportBlock = await requireSupportWrite(orgId);
  if (supportBlock) return supportBlock;
  const db = createAdminClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_json", "Payload inválido.", 400, { requestId });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  }

  const payload = parsed.data;

  try {
    // -----------------------------------------------------------------------
    // Ação: Obter URL de autorização da Meta
    // -----------------------------------------------------------------------
    if (payload.action === "get_connect_url") {
      const creds = await resolveInstagramCreds(db, orgId);
      const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
      const redirectUri = `${appUrl}/api/v1/channels/instagram/callback`;
      const state = Buffer.from(
        JSON.stringify({ org: orgId, uid: auth.user.id, ts: Date.now() }),
      ).toString("base64url");

      const authUrl = buildAuthorizeUrl(creds, redirectUri, state);
      return ok({ auth_url: authUrl });
    }

    // -----------------------------------------------------------------------
    // Ação: Vincular Agente de IA à conta do Instagram
    // -----------------------------------------------------------------------
    if (payload.action === "set_agent") {
      const { data: session } = await db
        .from("channel_sessions")
        .select("id, metadata")
        .eq("organization_id", orgId)
        .eq("provider", SOCIAL_PROVIDER)
        .is("archived_at", null)
        .maybeSingle();

      if (!session) {
        return fail("not_found", "Nenhuma conta do Instagram conectada.", 404, { requestId });
      }

      const prevMeta = (session.metadata ?? {}) as Record<string, unknown>;
      const newMeta = { ...prevMeta, agent_id: payload.agent_id };

      await db
        .from("channel_sessions")
        .update({ metadata: newMeta, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("organization_id", orgId);

      await audit({
        action: "channel.ai_access_updated",
        actorUserId: auth.user.id,
        organizationId: orgId,
        resourceType: "channel_session",
        resourceId: session.id,
        requestId,
        metadata: { agent_id: payload.agent_id },
      });

      return ok({ success: true, agent_id: payload.agent_id });
    }

    // -----------------------------------------------------------------------
    // Ação: Salvar Regras de Automação de Palavras-Chave (Básico e Visual)
    // -----------------------------------------------------------------------
    if (payload.action === "save_keywords") {
      const { data: session } = await db
        .from("channel_sessions")
        .select("id, metadata")
        .eq("organization_id", orgId)
        .eq("provider", SOCIAL_PROVIDER)
        .is("archived_at", null)
        .maybeSingle();

      if (!session) {
        return fail("not_found", "Nenhuma conta do Instagram conectada.", 404, { requestId });
      }

      const prevMeta = (session.metadata ?? {}) as Record<string, unknown>;
      const prevRules = Array.isArray(prevMeta.keyword_rules)
        ? (prevMeta.keyword_rules as InstagramKeywordRule[])
        : [];

      // Preserva as estatísticas já acumuladas de cada regra ao atualizar
      const mergedRules = payload.rules.map((r) => {
        const existing = prevRules.find((pr) => pr.id === r.id);
        return {
          ...r,
          stats: r.stats ?? existing?.stats ?? null,
        };
      });

      const newMeta = { ...prevMeta, keyword_rules: mergedRules };

      await db
        .from("channel_sessions")
        .update({ metadata: newMeta, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("organization_id", orgId);

      await audit({
        action: "channel.social_configured",
        actorUserId: auth.user.id,
        organizationId: orgId,
        resourceType: "channel_session",
        resourceId: session.id,
        requestId,
        metadata: { keyword_rules_count: mergedRules.length },
      });

      return ok({ success: true, count: mergedRules.length });
    }

    // -----------------------------------------------------------------------
    // Ação: Limpar Histórico de Execuções de uma Regra (ou de todas)
    // -----------------------------------------------------------------------
    if (payload.action === "clear_rule_logs") {
      const { data: session } = await db
        .from("channel_sessions")
        .select("id, metadata")
        .eq("organization_id", orgId)
        .eq("provider", SOCIAL_PROVIDER)
        .is("archived_at", null)
        .maybeSingle();

      if (!session) {
        return fail("not_found", "Nenhuma conta do Instagram conectada.", 404, { requestId });
      }

      const prevMeta = (session.metadata ?? {}) as Record<string, unknown>;
      const prevLogs = Array.isArray(prevMeta.rule_executions)
        ? (prevMeta.rule_executions as InstagramRuleExecutionLog[])
        : [];
      const prevRules = Array.isArray(prevMeta.keyword_rules)
        ? (prevMeta.keyword_rules as InstagramKeywordRule[])
        : [];

      const nextLogs = payload.rule_id
        ? prevLogs.filter((l) => l.rule_id !== payload.rule_id)
        : [];
      const nextRules = prevRules.map((r) => {
        if (payload.rule_id && r.id !== payload.rule_id) return r;
        return { ...r, stats: null };
      });

      const newMeta = {
        ...prevMeta,
        keyword_rules: nextRules,
        rule_executions: nextLogs,
      };

      await db
        .from("channel_sessions")
        .update({ metadata: newMeta, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("organization_id", orgId);

      return ok({ success: true });
    }

    // -----------------------------------------------------------------------
    // Ação: Salvar Credenciais Próprias da Meta (Multi-Tenant)
    // -----------------------------------------------------------------------
    if (payload.action === "save_credentials") {
      const { data: orgData } = await db
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .single();

      const prevSettings = (orgData?.settings ?? {}) as Record<string, unknown>;
      const newSettings = {
        ...prevSettings,
        instagram: payload.credentials as InstagramTenantConfig,
      };

      await db
        .from("organizations")
        .update({ settings: newSettings, updated_at: new Date().toISOString() })
        .eq("id", orgId);

      await audit({
        action: "org.updated",
        actorUserId: auth.user.id,
        organizationId: orgId,
        resourceType: "organization",
        resourceId: orgId,
        requestId,
        metadata: { custom_instagram: true },
      });

      return ok({ success: true });
    }

    // -----------------------------------------------------------------------
    // Ação: Desconectar Instagram
    // -----------------------------------------------------------------------
    if (payload.action === "disconnect") {
      const { data: session } = await db
        .from("channel_sessions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("provider", SOCIAL_PROVIDER)
        .is("archived_at", null)
        .maybeSingle();

      if (session) {
        const now = new Date().toISOString();
        await db
          .from("channel_sessions")
          .update({
            archived_at: now,
            status: "STOPPED",
            updated_at: now,
          })
          .eq("id", session.id)
          .eq("organization_id", orgId);

        await fecharAvisoDePausaDoCanalArquivado(db, {
          id: session.id,
          organization_id: orgId,
        });

        await audit({
          action: "channel.archived",
          actorUserId: auth.user.id,
          organizationId: orgId,
          resourceType: "channel_session",
          resourceId: session.id,
          requestId,
        });
      }

      return ok({ disconnected: true });
    }

    return fail("unsupported_action", "Ação não suportada.", 400, { requestId });
  } catch (err) {
    return fail(
      "instagram_operation_failed",
      err instanceof Error ? err.message : "Falha na operação do Instagram.",
      500,
      { requestId },
    );
  }
}
