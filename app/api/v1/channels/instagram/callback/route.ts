import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { resolveInstagramCreds } from "@/lib/channels/instagram/credentials";
import {
  exchangeCode,
  toLongLivedToken,
  getInstagramMe,
  subscribeInstagramWebhooks,
} from "@/lib/channels/instagram/api";
import { upsertInstagramChannelSession } from "@/lib/channels/instagram/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const back = (msg: string, ok = false) =>
    NextResponse.redirect(
      `${appUrl}/app/connections?aba=sociais&${ok ? "connected" : "error"}=${encodeURIComponent(msg)}`,
    );

  if (p.get("error")) {
    const desc = p.get("error_description") || p.get("error_reason") || "Autorização cancelada na Meta.";
    return back(desc);
  }

  const code = p.get("code")?.replace(/#_$/, "");
  const stateRaw = p.get("state");

  if (!code || !stateRaw) {
    return back("Link de conexão expirado ou inválido.");
  }

  let state: { org: string; uid: string; ts: number };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return back("Estado da sessão inválido. Tente conectar novamente.");
  }

  const db = createAdminClient();

  try {
    const creds = await resolveInstagramCreds(db, state.org);
    const redirectUri = `${appUrl}/api/v1/channels/instagram/callback`;

    // 1. Troca o código por um access token
    const short = await exchangeCode(creds, code, redirectUri);

    // 2. Converte para token de longa duração
    const long = await toLongLivedToken(creds, short.accessToken);

    // 3. Obtém informações da conta do Instagram
    const fallbackId = process.env.INSTAGRAM_ACCOUNT_ID || "17841400338102802";
    const me = await getInstagramMe(creds, long.access_token, fallbackId);

    // 4. Inscreve os webhooks para receber mensagens e comentários
    try {
      await subscribeInstagramWebhooks(creds, long.access_token, me.id);
    } catch (err) {
      logger.warn("[instagram.callback] Subscrição de webhook falhou", {
        erro: err instanceof Error ? err.message : String(err),
      });
    }

    // 5. Cifra o token para salvar no banco
    const encryptedToken = await encryptWebhookSecret(db, long.access_token);
    if (!encryptedToken) {
      throw new Error("Não foi possível cifrar o token de acesso.");
    }

    // 6. Cria ou atualiza a sessão do canal para esta organização
    await upsertInstagramChannelSession(db, {
      orgId: state.org,
      userId: state.uid,
      accountId: me.id,
      username: me.username,
      encryptedToken,
      metadata: {
        platform: "instagram",
        social_platform: "instagram",
        direct_meta: true,
        username: me.username,
        name: me.name || me.username,
        ig_user_id: me.id,
        access_token: long.access_token,
        profile_picture_url: me.profile_picture_url || null,
        token_expires_at: new Date(Date.now() + long.expires_in * 1000).toISOString(),
      },
    });

    return back(`@${me.username} conectado com sucesso!`, true);
  } catch (err) {
    logger.error("[instagram.callback] Erro ao conectar conta do Instagram", {
      erro: err instanceof Error ? err.message : String(err),
    });
    return back(err instanceof Error ? err.message : "Falha ao concluir a conexão com a Meta.");
  }
}
