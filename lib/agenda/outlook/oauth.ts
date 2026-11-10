/**
 * OAuth 2.0 com Microsoft Identity Platform (Azure AD / Microsoft Graph)
 */

import { ESCOPOS_OUTLOOK, type ConfiguracaoOutlook } from "./config";

export function montarUrlDeConsentimentoOutlook(params: {
  config: ConfiguracaoOutlook;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", params.config.clientId ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", ESCOPOS_OUTLOOK.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

export interface TokensOutlook {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  email: string;
  nome?: string;
}

export async function trocarCodigoPorTokensOutlook(params: {
  config: ConfiguracaoOutlook;
  code: string;
  redirectUri: string;
}): Promise<TokensOutlook> {
  const tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: params.config.clientId ?? "",
    client_secret: params.config.clientSecret ?? "",
    code: params.code,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao obter tokens da Microsoft: ${errText}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Obtém os dados do perfil do usuário na Microsoft Graph API
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${json.access_token}` },
  });

  let email = "usuario@outlook.com";
  let nome = "Usuário Microsoft";

  if (meRes.ok) {
    const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    email = me.mail || me.userPrincipalName || email;
    nome = me.displayName || nome;
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    email,
    nome,
  };
}
