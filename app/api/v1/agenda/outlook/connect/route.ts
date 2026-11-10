import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { configuracaoDoOutlook, CAMINHO_DO_CALLBACK_OUTLOOK } from "@/lib/agenda/outlook/config";
import { montarUrlDeConsentimentoOutlook } from "@/lib/agenda/outlook/oauth";
import { env } from "@/lib/env";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authz = await requireRole("agent");
  if (!authz.ok) return authz.response;

  const config = configuracaoDoOutlook();
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const redirectUri = `${appUrl}${CAMINHO_DO_CALLBACK_OUTLOOK}`;

  if (!config.configurado) {
    return NextResponse.redirect(`${appUrl}/app/agenda?erro=outlook_nao_configurado`);
  }

  const state = Buffer.from(
    JSON.stringify({
      org: authz.orgId,
      uid: authz.userId,
      nonce: randomBytes(16).toString("hex"),
      ts: Date.now(),
    }),
  ).toString("base64url");

  const consentUrl = montarUrlDeConsentimentoOutlook({
    config,
    redirectUri,
    state,
  });

  return NextResponse.redirect(consentUrl);
}
