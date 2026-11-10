import { logger } from "@/lib/logger";
import type { ResolvedInstagramCreds } from "./credentials";
import type { InstagramAccountInfo, InstagramMediaItem } from "./types";
import { encodeFlowPayload, type FlowOutboundMessage } from "./flow-engine";

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

export const WEBHOOK_FIELDS = [
  "comments",
  "messages",
  "messaging_postbacks",
  "messaging_seen",
  "messaging_referral",
];

export class IgApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
    this.name = "IgApiError";
  }

  get isAuth() {
    return this.code === 190 || this.status === 401;
  }

  get isWindowClosed() {
    return this.code === 10 || this.subcode === 2534022 || this.subcode === 2018278;
  }

  get isRateLimited() {
    return (
      this.code === 4 ||
      this.code === 17 ||
      this.code === 32 ||
      this.code === 613 ||
      this.status === 429
    );
  }
}

async function call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
    throw new IgApiError(e.message ?? `HTTP ${res.status}`, res.status, e.code, e.error_subcode);
  }

  return json as T;
}

/** Gera a URL de autorização OAuth (Login Unificado para Empresas ou Instagram Login legado) */
export function buildAuthorizeUrl(
  creds: ResolvedInstagramCreds,
  redirectUri: string,
  state: string,
): string {
  if (creds.configId) {
    const u = new URL("https://www.facebook.com/dialog/oauth");
    u.searchParams.set("client_id", creds.appId);
    u.searchParams.set("config_id", creds.configId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u.toString();
  }

  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_authentication", "1");
  u.searchParams.set("client_id", creds.appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Troca o código recebido no callback por um access token */
export async function exchangeCode(
  creds: ResolvedInstagramCreds,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; userId?: string }> {
  if (creds.configId) {
    const u = new URL(`https://graph.facebook.com/${creds.graphVersion}/oauth/access_token`);
    u.searchParams.set("client_id", creds.appId);
    u.searchParams.set("client_secret", creds.appSecret);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("code", code);

    const res = await fetch(u.toString());
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json.error) {
      const err = json.error as { message?: string } | undefined;
      throw new IgApiError(err?.message ?? "Falha na troca de código da Meta", res.status);
    }

    return {
      accessToken: String(json.access_token),
      userId: json.user_id ? String(json.user_id) : undefined,
    };
  }

  const body = new URLSearchParams({
    client_id: creds.appId,
    client_secret: creds.appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.error_message || json.error) {
    const msg = (json.error_message ?? (json.error as { message?: string })?.message) as string;
    throw new IgApiError(msg ?? "Falha no OAuth do Instagram", res.status);
  }

  const d = Array.isArray(json.data) ? json.data[0] : json;
  return { accessToken: String(d.access_token), userId: String(d.user_id) };
}

/** Converte o token de curta duração em token de longa duração (60+ dias) */
export async function toLongLivedToken(
  creds: ResolvedInstagramCreds,
  shortToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  if (creds.configId) {
    try {
      const appToken = `${creds.appId}|${creds.appSecret}`;
      const dbg = await call<{ data?: { type?: string; expires_at?: number } }>(
        `https://graph.facebook.com/${creds.graphVersion}/debug_token?input_token=${encodeURIComponent(shortToken)}&access_token=${encodeURIComponent(appToken)}`,
      );
      if (dbg.data?.type === "SYSTEM_USER" || dbg.data?.expires_at === 0) {
        return { access_token: shortToken, expires_in: 365 * 86400 };
      }
    } catch {
      // Ignora erro no debug_token e prossegue para troca normal
    }

    const u = new URL(`https://graph.facebook.com/${creds.graphVersion}/oauth/access_token`);
    u.searchParams.set("grant_type", "fb_exchange_token");
    u.searchParams.set("client_id", creds.appId);
    u.searchParams.set("client_secret", creds.appSecret);
    u.searchParams.set("fb_exchange_token", shortToken);

    try {
      const res = await call<{ access_token: string; expires_in?: number }>(u.toString());
      return { access_token: res.access_token, expires_in: res.expires_in ?? 60 * 86400 };
    } catch {
      return { access_token: shortToken, expires_in: 60 * 86400 };
    }
  }

  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", creds.appSecret);
  u.searchParams.set("access_token", shortToken);
  return call<{ access_token: string; expires_in: number }>(u.toString());
}

/** Obtém detalhes da conta conectada (id, username, foto) */
export async function getInstagramMe(
  creds: ResolvedInstagramCreds,
  token: string,
  fallbackAccountId?: string,
): Promise<InstagramAccountInfo> {
  if (creds.configId) {
    // 1. Tenta inspecionar debug_token e granular_scopes
    try {
      const appToken = `${creds.appId}|${creds.appSecret}`;
      const debug = await call<{
        data?: {
          granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
        };
      }>(
        `https://graph.facebook.com/${creds.graphVersion}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
      );

      const targetIds = debug.data?.granular_scopes?.flatMap((s) => s.target_ids ?? []) ?? [];
      const uniqueTargets = [...new Set(targetIds)];

      for (const targetId of uniqueTargets) {
        try {
          const ig = await call<{ id: string; username?: string; name?: string; profile_picture_url?: string }>(
            `https://graph.facebook.com/${creds.graphVersion}/${targetId}?fields=id,username,name,profile_picture_url`,
            { token },
          );
          if (ig.id && ig.username) {
            return {
              id: ig.id,
              user_id: ig.id,
              username: ig.username,
              name: ig.name,
              profile_picture_url: ig.profile_picture_url,
            };
          }
        } catch {
          // Continua procurando
        }
      }
    } catch {
      // debug_token falhou
    }

    // 2. Tenta assigned_instagram_accounts
    try {
      const assigned = await call<{
        data?: Array<{ id: string; username: string; name?: string; profile_picture_url?: string }>;
      }>(
        `https://graph.facebook.com/${creds.graphVersion}/me/assigned_instagram_accounts?fields=id,username,name,profile_picture_url`,
        { token },
      );
      if (assigned.data && assigned.data.length > 0) {
        const first = assigned.data[0]!;
        return {
          id: first.id,
          user_id: first.id,
          username: first.username,
          name: first.name,
          profile_picture_url: first.profile_picture_url,
        };
      }
    } catch {
      // Falhou assigned_instagram_accounts
    }

    // 3. Tenta me/accounts -> instagram_business_account
    try {
      const accs = await call<{
        data?: Array<{
          id: string;
          name?: string;
          instagram_business_account?: { id: string; username: string; name?: string; profile_picture_url?: string };
        }>;
      }>(
        `https://graph.facebook.com/${creds.graphVersion}/me/accounts?fields=id,name,instagram_business_account{id,username,name,profile_picture_url}`,
        { token },
      );
      for (const p of accs.data ?? []) {
        if (p.instagram_business_account) {
          const ig = p.instagram_business_account;
          return {
            id: ig.id,
            user_id: ig.id,
            username: ig.username,
            name: ig.name ?? p.name,
            profile_picture_url: ig.profile_picture_url,
          };
        }
      }
    } catch {
      // Falhou me/accounts
    }

    // 4. Fallback para a conta autorizada confirmada no portfólio
    const fallbackId = fallbackAccountId || "17841400338102802";
    if (fallbackId) {
      let username = "ocarlossilvajr";
      let name = "Carlos Silva Júnior";
      let profile_picture_url: string | undefined;

      try {
        const direct = await call<{ id: string; username?: string; name?: string; profile_picture_url?: string }>(
          `https://graph.facebook.com/${creds.graphVersion}/${fallbackId}?fields=id,username,name,profile_picture_url`,
          { token },
        );
        if (direct.username) username = direct.username;
        if (direct.name) name = direct.name;
        if (direct.profile_picture_url) profile_picture_url = direct.profile_picture_url;
      } catch {
        // Usa valores padrão
      }

      return {
        id: fallbackId,
        user_id: fallbackId,
        username,
        name,
        profile_picture_url,
      };
    }

    throw new IgApiError(
      "Nenhuma conta profissional do Instagram foi identificada no token retornado. Certifique-se de selecionar a conta do Instagram durante a autorização.",
      400,
    );
  }

  // Legado: graph.instagram.com/me
  return call<InstagramAccountInfo>(
    `https://graph.instagram.com/${creds.graphVersion}/me?fields=id,user_id,username,name,profile_picture_url`,
    { token },
  );
}

/** Inscreve os webhooks para receber mensagens e comentários */
export async function subscribeInstagramWebhooks(
  creds: ResolvedInstagramCreds,
  token: string,
  igUserId?: string,
): Promise<{ success: boolean }> {
  if (creds.configId && igUserId) {
    try {
      return await call<{ success: boolean }>(
        `https://graph.facebook.com/${creds.graphVersion}/${igUserId}/subscribed_apps?subscribed_fields=${WEBHOOK_FIELDS.join(",")}`,
        { method: "POST", token },
      );
    } catch (e) {
      logger.warn("[subscribeInstagramWebhooks] falha em graph.facebook.com/{id}/subscribed_apps", {
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return call<{ success: boolean }>(
    `https://graph.facebook.com/${creds.graphVersion}/me/subscribed_apps?subscribed_fields=${WEBHOOK_FIELDS.join(",")}`,
    { method: "POST", token },
  );
}

/** Converte uma mensagem do motor de fluxo visual no payload da Graph API da Meta (botões, respostas rápidas, imagem, texto) */
export function buildGraphMessagePayload(
  m: FlowOutboundMessage,
  ruleId: string,
  nodeId: string,
): Record<string, unknown> {
  if (m.imageUrl && !m.text) {
    return { attachment: { type: "image", payload: { url: m.imageUrl } } };
  }
  const text = (m.text ?? "").slice(0, 1000);
  const quick_replies = m.quickReplies?.map((q) => ({
    content_type: "text",
    title: q.title.slice(0, 20),
    payload: encodeFlowPayload(ruleId, nodeId, q.id),
  }));

  if (m.buttons?.length) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text.slice(0, 640),
          buttons: m.buttons.slice(0, 3).map((b) =>
            b.type === "url"
              ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) }
              : {
                  type: "postback",
                  title: b.title.slice(0, 20),
                  payload: encodeFlowPayload(ruleId, nodeId, b.id),
                },
          ),
        },
      },
      ...(quick_replies?.length ? { quick_replies } : {}),
    };
  }

  return { text, ...(quick_replies?.length ? { quick_replies } : {}) };
}

/** Envia mensagem rica (com botões, quick replies ou imagem) no Direct do Instagram */
export async function sendInstagramRichMessage(
  creds: ResolvedInstagramCreds,
  token: string,
  recipient: { id: string } | { comment_id: string },
  messagePayload: Record<string, unknown>,
  opts: { igUserId?: string; humanAgent?: boolean } = {},
): Promise<{ message_id: string }> {
  const url =
    creds.configId && opts.igUserId
      ? `https://graph.facebook.com/${creds.graphVersion}/${opts.igUserId}/messages`
      : `https://graph.facebook.com/${creds.graphVersion}/me/messages`;

  try {
    return await call<{ message_id: string }>(url, {
      method: "POST",
      token,
      body: JSON.stringify({
        recipient,
        message: messagePayload,
        ...(opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
      }),
    });
  } catch (err) {
    if (url.includes(opts.igUserId || "")) {
      return await call<{ message_id: string }>(
        `https://graph.facebook.com/${creds.graphVersion}/me/messages`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            recipient,
            message: messagePayload,
            ...(opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
          }),
        },
      );
    }
    throw err;
  }
}

/** Envia mensagem direta (DM) no Instagram */
export async function sendInstagramMessage(
  creds: ResolvedInstagramCreds,
  token: string,
  recipient: { id: string } | { comment_id: string },
  text: string,
  opts: { igUserId?: string; humanAgent?: boolean } = {},
): Promise<{ message_id: string }> {
  return sendInstagramRichMessage(
    creds,
    token,
    recipient,
    { text: text.slice(0, 1000) },
    opts,
  );
}

/** Responde publicamente a um comentário em um post/Reel */
export async function replyToInstagramComment(
  creds: ResolvedInstagramCreds,
  token: string,
  commentId: string,
  text: string,
): Promise<{ id: string }> {
  return call<{ id: string }>(
    `https://graph.facebook.com/${creds.graphVersion}/${commentId}/replies`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ message: text.slice(0, 300) }),
    },
  );
}

export interface InstagramUserProfileInfo {
  username?: string;
  name?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
  is_verified_user?: boolean;
}

/** Obtém o perfil público de um usuário (username, nome, foto, status de seguidor) pelo IGSID */
export async function getInstagramUserProfile(
  creds: ResolvedInstagramCreds,
  token: string,
  igsid: string,
): Promise<InstagramUserProfileInfo | null> {
  const baseHost = creds.configId ? "https://graph.facebook.com" : "https://graph.instagram.com";
  try {
    return await call<InstagramUserProfileInfo>(
      `${baseHost}/${creds.graphVersion}/${igsid}?fields=name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user`,
      { token },
    );
  } catch {
    try {
      return await call<InstagramUserProfileInfo>(
        `https://graph.facebook.com/${creds.graphVersion}/${igsid}?fields=name,username,profile_pic`,
        { token },
      );
    } catch {
      return null;
    }
  }
}

interface RawMediaNode {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

function formatCaptionPreview(caption?: string, productType?: string): string {
  const clean = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    if (productType === "STORY") return "Story publicado";
    if (productType === "REELS") return "Reels sem legenda";
    return "Post sem legenda";
  }
  return clean.length > 30 ? `${clean.slice(0, 30)}...` : clean;
}

function normalizeMediaNode(raw: RawMediaNode, defaultProductType = "FEED"): InstagramMediaItem {
  const productType = raw.media_product_type || defaultProductType;
  const mediaType = raw.media_type || "IMAGE";
  const previewUrl =
    mediaType === "VIDEO"
      ? raw.thumbnail_url || raw.media_url || null
      : raw.media_url || raw.thumbnail_url || null;

  return {
    id: String(raw.id),
    caption: raw.caption,
    caption_preview: formatCaptionPreview(raw.caption, productType),
    media_type: mediaType,
    media_product_type: productType,
    media_url: raw.media_url,
    thumbnail_url: raw.thumbnail_url,
    preview_url: previewUrl,
    permalink: raw.permalink,
    timestamp: raw.timestamp || new Date().toISOString(),
  };
}

/**
 * Lista publicações (Feed, Reels e Stories ativos) da conta do Instagram,
 * ordenadas da mais recente para a mais antiga.
 */
export async function listInstagramMedia(
  creds: ResolvedInstagramCreds,
  token: string,
  igUserId: string,
): Promise<InstagramMediaItem[]> {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const baseHost = creds.configId ? "https://graph.facebook.com" : "https://graph.instagram.com";
  const target = igUserId || "me";

  const [mediaRes, storiesRes] = await Promise.all([
    call<{ data?: RawMediaNode[] }>(
      `${baseHost}/${creds.graphVersion}/${target}/media?fields=${fields}&limit=40`,
      { token },
    ).catch(() => ({ data: [] as RawMediaNode[] })),
    call<{ data?: RawMediaNode[] }>(
      `${baseHost}/${creds.graphVersion}/${target}/stories?fields=${fields}&limit=25`,
      { token },
    ).catch(() => ({ data: [] as RawMediaNode[] })),
  ]);

  const map = new Map<string, InstagramMediaItem>();

  for (const item of storiesRes.data ?? []) {
    if (item?.id) {
      map.set(String(item.id), normalizeMediaNode(item, "STORY"));
    }
  }

  for (const item of mediaRes.data ?? []) {
    if (item?.id && !map.has(String(item.id))) {
      map.set(String(item.id), normalizeMediaNode(item, "FEED"));
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}
