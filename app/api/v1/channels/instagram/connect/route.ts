import { NextResponse } from "next/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { resolveInstagramCreds } from "@/lib/channels/instagram/credentials";
import { buildAuthorizeUrl } from "@/lib/channels/instagram/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await loadAuthUser();
  if (!user) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/login`);
  }

  const orgId = await resolveActiveOrg();
  if (!orgId) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/app`);
  }

  const db = createAdminClient();
  const creds = await resolveInstagramCreds(db, orgId);

  const appUrl = (env.NEXT_PUBLIC_APP_URL || "https://crm.nexusia.work").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/v1/channels/instagram/callback`;
  const state = Buffer.from(
    JSON.stringify({ org: orgId, uid: user.id, ts: Date.now() }),
  ).toString("base64url");

  const authorizeUrl = buildAuthorizeUrl(creds, redirectUri, state);
  return NextResponse.redirect(authorizeUrl);
}
