import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { resolveInstagramCreds } from "@/lib/channels/instagram/credentials";
import { buildAuthorizeUrl } from "@/lib/channels/instagram/api";
import { SOCIAL_PROVIDER } from "@/lib/channels/social/catalog";
import type { InstagramKeywordRule, InstagramTenantConfig } from "@/lib/channels/instagram/types";

export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  id: z.string(),
  type: z.enum(["comment_keyword", "story_mention", "dm_keyword"]),
  keywords: z.array(z.string()),
  match: z.enum(["contains", "exact"]),
  public_reply: z.string().nullable().optional(),
  dm_message: z.string().min(1),
  active: z.boolean(),
});

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_connect_url") }).strict(),
  z.object({ action: z.literal("set_agent"), agent_id: z.string().nullable() }).strict(),
  z.object({ action: z.literal("save_keywords"), rules: z.array(ruleSchema) }).strict(),
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

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("user", { requestId, resource: "instagram_channel" });
  if (!auth.ok) return auth.response;

  const orgId = auth.org.orgId;
  const db = createAdminClient();

  try {
    // 1. Busca a sessão do canal do Instagram desta organização
    const { data: session } = await db
      .from("channel_sessions")
      .select("id, display_name, status, zernio_account_id, metadata, created_at, updated_at")
      .eq("organization_id", orgId)
      .eq("provider", SOCIAL_PROVIDER)
      .is("archived_at", null)
      .maybeSingle();

    const metadata = (session?.metadata ?? {}) as Record<string, unknown>;
    const isDirectMeta = metadata.direct_meta === true;

    // 2. Busca lista de agentes de IA disponíveis na organização
    const { data: agents } = await db
      .from("ai_agents")
      .select("id, name, description, role, status")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    // 3. Resolve as credenciais (tenant ou fallback)
    const creds = await resolveInstagramCreds(db, orgId);

    const appUrl = (env.NEXT_PUBLIC_APP_URL || "https://crm.nexusia.work").replace(/\/$/, "");
    const webhookUrl = `${appUrl}/api/v1/webhooks/instagram`;

    const account =
      session && isDirectMeta
        ? {
            id: session.id,
            accountId: session.zernio_account_id,
            username: (metadata.username as string) || session.display_name?.replace(/^Instagram · @/, "") || "",
            name: (metadata.name as string) || "",
            profile_picture_url: (metadata.profile_picture_url as string) || null,
            status: session.status,
            connectedAt: session.created_at,
          }
        : null;

    return ok({
      connected: Boolean(account),
      account,
      agent_id: (metadata.agent_id as string) || null,
      keyword_rules: (metadata.keyword_rules as InstagramKeywordRule[]) || [],
      available_agents: agents ?? [],
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
      const appUrl = (env.NEXT_PUBLIC_APP_URL || "https://crm.nexusia.work").replace(/\/$/, "");
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
        organizationId: orgId,
        actorId: auth.user.id,
        action: "channel_session.update",
        entity: "channel_sessions",
        entityId: session.id,
        after: { agent_id: payload.agent_id },
      });

      return ok({ success: true, agent_id: payload.agent_id });
    }

    // -----------------------------------------------------------------------
    // Ação: Salvar Regras de Automação de Palavras-Chave (Comentários e Stories)
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
      const newMeta = { ...prevMeta, keyword_rules: payload.rules };

      await db
        .from("channel_sessions")
        .update({ metadata: newMeta, updated_at: new Date().toISOString() })
        .eq("id", session.id)
        .eq("organization_id", orgId);

      await audit({
        organizationId: orgId,
        actorId: auth.user.id,
        action: "channel_session.update",
        entity: "channel_sessions",
        entityId: session.id,
        after: { keyword_rules_count: payload.rules.length },
      });

      return ok({ success: true, count: payload.rules.length });
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
        organizationId: orgId,
        actorId: auth.user.id,
        action: "organization.update_settings",
        entity: "organizations",
        entityId: orgId,
        after: { custom_instagram: true },
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
        await db
          .from("channel_sessions")
          .update({
            archived_at: new Date().toISOString(),
            status: "STOPPED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id)
          .eq("organization_id", orgId);

        await audit({
          organizationId: orgId,
          actorId: auth.user.id,
          action: "channel_session.archive",
          entity: "channel_sessions",
          entityId: session.id,
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
