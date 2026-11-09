import { NextResponse } from "next/server";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
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

  const orgCheck = await orgAtivaDaApi(user);
  if (!orgCheck.ok) {
    return orgCheck.response;
  }
  const org = orgCheck.org;
  if (!org) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/app`);
  }

  const orgId = org.orgId;
  const db = createAdminClient();
  const creds = await resolveInstagramCreds(db, orgId);

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/v1/channels/instagram/callback`;
  const state = Buffer.from(
    JSON.stringify({ org: orgId, uid: user.id, ts: Date.now() }),
  ).toString("base64url");

  const authorizeUrl = buildAuthorizeUrl(creds, redirectUri, state);
  return NextResponse.redirect(authorizeUrl);
}
