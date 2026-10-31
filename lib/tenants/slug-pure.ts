/**
 * Funções puras de slug de organizações (Edge-safe).
 */

export const RESERVED_SLUGS = new Set([
  "app",
  "admin",
  "api",
  "auth",
  "login",
  "signup",
  "onboarding",
  "legal",
  "team",
  "get-started",
  "design",
  "vitrine-agenda",
  "account-suspended",
  "acesso-revogado",
  "support-ended",
  "cobranca",
  "icon",
  "app-icon",
  "manifest",
  "favicon",
  "monitoring",
  "email-templates",
  "iconografia",
]);

/**
 * Normaliza o nome da empresa em um slug contínuo, sem acentos, sem espaços e sem símbolos.
 * Exemplo: "Clínica São José & Cia. 123" -> "clinicasaojosecia123"
 */
export function slugifyEmpresa(name: string): string {
  const limpo = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // remove espaços, traços e símbolos
    .slice(0, 40);

  return limpo || "empresa";
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
