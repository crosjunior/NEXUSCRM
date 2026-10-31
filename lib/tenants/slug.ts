/**
 * Utilitários de normalização e resolução de slug de organizações (Tenants).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { isReservedSlug, slugifyEmpresa } from "./slug-pure";

export * from "./slug-pure";

export interface OrganizationTenantSummary {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accentHex: string;
  timezone: string;
}

/**
 * Busca uma organização pelo slug direto ou pelo slug normalizado (sem hífen).
 * Permite que tanto "minha-empresa" quanto "minhaempresa" resolvam a mesma organização.
 */
export async function resolveOrganizationBySlug(
  rawSlug: string,
): Promise<OrganizationTenantSummary | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug || isReservedSlug(slug)) return null;

  const admin = createAdminClient();

  // Busca exata pelo slug ou ignorando hífens
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, slug, display_name, legal_name, timezone, settings")
    .eq("status", "active")
    .limit(10);

  if (error || !orgs || orgs.length === 0) return null;

  // Encontra a organização compatível
  const slugLimpo = slug.replace(/[^a-z0-9]/g, "");
  const correspondente = orgs.find((o) => {
    const oSlug = (o.slug || "").toLowerCase();
    const oSlugLimpo = oSlug.replace(/[^a-z0-9]/g, "");
    return (
      oSlug === slug ||
      oSlugLimpo === slugLimpo ||
      slugifyEmpresa(o.display_name) === slugLimpo
    );
  });

  if (!correspondente) return null;

  const settings = (correspondente.settings ?? {}) as Record<string, unknown>;
  const branding = (settings.branding ?? {}) as Record<string, unknown>;

  const logoUrl = typeof branding.logo_url === "string" ? branding.logo_url : null;
  const logoDarkUrl = typeof branding.logo_dark_url === "string" ? branding.logo_dark_url : null;
  const accentHex = typeof branding.accent_hex === "string" ? branding.accent_hex : "#506d48";
  const displayName =
    typeof branding.app_name === "string" && branding.app_name.trim()
      ? branding.app_name
      : correspondente.display_name;

  return {
    id: correspondente.id,
    slug: correspondente.slug,
    displayName,
    legalName: correspondente.legal_name,
    logoUrl,
    logoDarkUrl,
    accentHex,
    timezone: correspondente.timezone,
  };
}
