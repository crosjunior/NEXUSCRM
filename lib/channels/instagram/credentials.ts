import type { SupabaseClient } from "@supabase/supabase-js";
import { graphVersion } from "@/lib/graph-version";
import type { InstagramTenantConfig } from "./types";

export interface ResolvedInstagramCreds {
  appId: string;
  appSecret: string;
  configId: string;
  verifyToken: string;
  graphVersion: string;
}

export const DEFAULT_INSTAGRAM_APP_ID = "1002166082905050";
export const DEFAULT_INSTAGRAM_APP_SECRET = "6f8784f833a90c68e49741a56a3dd047";
export const DEFAULT_INSTAGRAM_CONFIG_ID = "1660645855857528";
export const DEFAULT_INSTAGRAM_VERIFY_TOKEN = "13c41bf757eece8583d880d5848c1cbc";

/**
 * Resolve as credenciais da Meta para a organização (multi-tenant).
 * Se a organização configurou credenciais próprias em `organizations.settings.instagram`,
 * usa as da organização. Caso contrário, cai nas credenciais do ambiente ou nos defaults de produção.
 */
export async function resolveInstagramCreds(
  db: SupabaseClient,
  organizationId?: string | null,
): Promise<ResolvedInstagramCreds> {
  let tenantCustom: InstagramTenantConfig | null = null;

  if (organizationId) {
    try {
      const { data } = await db
        .from("organizations")
        .select("settings")
        .eq("id", organizationId)
        .maybeSingle();

      const settings = data?.settings as Record<string, unknown> | null;
      if (settings?.instagram && typeof settings.instagram === "object") {
        tenantCustom = settings.instagram as InstagramTenantConfig;
      }
    } catch {
      // Falha silenciosa ao ler settings do tenant; usa fallback
    }
  }

  const appId =
    tenantCustom?.app_id?.trim() ||
    process.env.INSTAGRAM_APP_ID?.trim() ||
    DEFAULT_INSTAGRAM_APP_ID;

  const appSecret =
    tenantCustom?.app_secret?.trim() ||
    process.env.INSTAGRAM_APP_SECRET?.trim() ||
    DEFAULT_INSTAGRAM_APP_SECRET;

  const configId =
    tenantCustom?.config_id?.trim() ||
    process.env.INSTAGRAM_CONFIG_ID?.trim() ||
    DEFAULT_INSTAGRAM_CONFIG_ID;

  const verifyToken =
    tenantCustom?.verify_token?.trim() ||
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
    DEFAULT_INSTAGRAM_VERIFY_TOKEN;

  const resolvedGraphVersion =
    process.env.INSTAGRAM_GRAPH_VERSION?.trim() || graphVersion();

  return {
    appId,
    appSecret,
    configId,
    verifyToken,
    graphVersion: resolvedGraphVersion,
  };
}
