/**
 * Configurações e constantes da integração com Microsoft Outlook e Teams via Microsoft Graph API
 */

export const PROVEDOR_OUTLOOK = "outlook" as const;
export const CAMINHO_DO_CALLBACK_OUTLOOK = "/api/v1/agenda/outlook/callback";

export const ESCOPOS_OUTLOOK = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
] as const;

export interface ConfiguracaoOutlook {
  clientId: string | null;
  clientSecret: string | null;
  configurado: boolean;
  falta: string[];
}

export function configuracaoDoOutlook(): ConfiguracaoOutlook {
  // Lê do env ou das configurações da organização/plataforma
  const clientId = (process.env.MICROSOFT_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID || "").trim() || null;
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET || "").trim() || null;

  const falta: string[] = [];
  if (!clientId) falta.push("MICROSOFT_CLIENT_ID");
  if (!clientSecret) falta.push("MICROSOFT_CLIENT_SECRET");

  return {
    clientId,
    clientSecret,
    configurado: falta.length === 0,
    falta,
  };
}
