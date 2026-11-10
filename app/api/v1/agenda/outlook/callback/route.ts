import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuracaoDoOutlook, CAMINHO_DO_CALLBACK_OUTLOOK } from "@/lib/agenda/outlook/config";
import { trocarCodigoPorTokensOutlook } from "@/lib/agenda/outlook/oauth";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { encryptKey } from "@/lib/crypto/aes_gcm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const code = req.nextUrl.searchParams.get("code");
  const stateStr = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam || !code || !stateStr) {
    return NextResponse.redirect(`${appUrl}/app/agenda?erro=outlook_negado`);
  }

  let state: { org: string; uid: string; ts: number };
  try {
    state = JSON.parse(Buffer.from(stateStr, "base64url").toString("utf8"));
  } catch {
    return NextResponse.redirect(`${appUrl}/app/agenda?erro=estado_invalido`);
  }

  const config = configuracaoDoOutlook();
  const redirectUri = `${appUrl}${CAMINHO_DO_CALLBACK_OUTLOOK}`;

  try {
    const tokens = await trocarCodigoPorTokensOutlook({
      config,
      code,
      redirectUri,
    });

    const admin = createAdminClient();

    // Criptografa o token de acesso e refresh
    const encryptedAccess = encryptKey(tokens.accessToken);
    const encryptedRefresh = tokens.refreshToken ? encryptKey(tokens.refreshToken) : null;

    // Salva ou atualiza em calendar_connections
    const { error: upsertErr } = await admin.from("calendar_connections").upsert(
      {
        organization_id: state.org,
        user_id: state.uid,
        provider: "outlook",
        account_email: tokens.email,
        access_token_encrypted: encryptedAccess,
        refresh_token_encrypted: encryptedRefresh,
        expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        metadata: {
          display_name: tokens.nome,
          connected_at: new Date().toISOString(),
        },
        status: "active",
      },
      { onConflict: "organization_id,user_id,provider,account_email" },
    );

    if (upsertErr) {
      console.error("[outlook-callback] erro ao gravar connection:", upsertErr.message);
      return NextResponse.redirect(`${appUrl}/app/agenda?erro=gravacao_falhou`);
    }

    void audit({
      action: "calendar.connected",
      actorUserId: state.uid,
      organizationId: state.org,
      resourceType: "calendar_connection",
      resourceId: tokens.email,
      metadata: { provider: "outlook", email: tokens.email },
    });

    return NextResponse.redirect(`${appUrl}/app/agenda?sucesso=outlook_conectado`);
  } catch (err) {
    console.error("[outlook-callback] erro na troca de tokens:", err);
    return NextResponse.redirect(`${appUrl}/app/agenda?erro=outlook_falha_geral`);
  }
}
