/**
 * Cliente HTTP para Evolution API v2 (Baileys).
 * Vive dentro de `lib/channels/` conforme a doutrina de restrição de canal.
 */

export interface EvolutionQrResult {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
  count?: number;
}

export interface EvolutionStateResult {
  state: "open" | "connecting" | "close" | "unknown";
  raw?: unknown;
}

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function extractEvolutionErrorMessage(json: unknown, status: number): string {
  if (typeof json !== "object" || json === null) {
    return typeof json === "string" && json.trim()
      ? json.trim()
      : `Evolution API respondeu HTTP ${status}`;
  }

  const record = json as Record<string, unknown>;

  // NestJS/Evolution: { response: { message: [...] } } ou { message: [...] } ou { message: "..." }
  const respObj =
    typeof record.response === "object" && record.response !== null
      ? (record.response as Record<string, unknown>)
      : null;

  const rawMsg = respObj?.message ?? record.message;
  if (Array.isArray(rawMsg) && rawMsg.length > 0) {
    const joined = rawMsg.map(String).join("; ");
    if (joined.toLowerCase().includes("connection closed")) {
      return "A instância do WhatsApp está desconectada no servidor Evolution (Connection Closed). Reconecte via QR Code ou Código de Pareamento.";
    }
    return joined;
  }
  if (typeof rawMsg === "string" && rawMsg.trim()) {
    if (rawMsg.toLowerCase().includes("connection closed")) {
      return "A instância do WhatsApp está desconectada no servidor Evolution (Connection Closed). Reconecte via QR Code ou Código de Pareamento.";
    }
    return rawMsg.trim();
  }

  if (typeof record.error === "string" && record.error.trim()) {
    if (record.error.toLowerCase().includes("connection closed")) {
      return "A instância do WhatsApp está desconectada no servidor Evolution (Connection Closed). Reconecte via QR Code ou Código de Pareamento.";
    }
    return record.error.trim();
  }

  return `Evolution API respondeu HTTP ${status}`;
}

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey?: string | null) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = (apiKey ?? process.env.EVOLUTION_API_KEY ?? "").trim();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h.apikey = this.apiKey;
    }
    return h;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          ...this.headers(),
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
    } catch (err) {
      throw new EvolutionApiError(
        err instanceof Error
          ? `Falha de conexão com o servidor Evolution (${err.message}).`
          : "Falha de conexão com o servidor Evolution.",
      );
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        const hint = this.apiKey
          ? "A API Key configurada foi recusada pelo servidor Evolution (401 Unauthorized)."
          : "Nenhuma API Key configurada para a Evolution API. Clique em 'Configurar Instância' e informe a API Key do servidor (ou defina EVOLUTION_API_KEY no .env).";
        throw new EvolutionApiError(hint, res.status);
      }
      const msg = extractEvolutionErrorMessage(json, res.status);
      throw new EvolutionApiError(msg, res.status);
    }

    return json as T;
  }

  async fetchConnectionState(instanceName: string): Promise<EvolutionStateResult> {
    const data = await this.request<{ instance?: { state?: string }; state?: string }>(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { method: "GET" },
    );
    const rawState = (data?.instance?.state ?? data?.state ?? "unknown").toLowerCase();
    if (rawState === "open" || rawState === "connected") return { state: "open", raw: data };
    if (rawState === "connecting") return { state: "connecting", raw: data };
    if (rawState === "close" || rawState === "closed" || rawState === "disconnected") return { state: "close", raw: data };
    return { state: "unknown", raw: data };
  }

  async createInstance(params: {
    instanceName: string;
    number?: string;
    webhookUrl?: string;
  }): Promise<unknown> {
    const digits = params.number ? onlyDigits(params.number) : undefined;
    return this.request("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: params.instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        ...(digits ? { number: digits } : {}),
        ...(params.webhookUrl
          ? {
              webhook: {
                url: params.webhookUrl,
                byEvents: false,
                base64: true,
                events: [
                  "MESSAGES_UPSERT",
                  "MESSAGES_UPDATE",
                  "CONNECTION_UPDATE",
                  "QRCODE_UPDATED",
                ],
              },
            }
          : {}),
      }),
    });
  }

  async getQrCode(instanceName: string): Promise<EvolutionQrResult> {
    const data = await this.request<{
      base64?: string;
      code?: string;
      pairingCode?: string;
      count?: number;
      qrcode?: { base64?: string; code?: string; pairingCode?: string };
    }>(`/instance/connect/${encodeURIComponent(instanceName)}`, { method: "GET" });

    const base64Raw = data?.base64 ?? data?.qrcode?.base64 ?? null;
    const base64 =
      base64Raw && !base64Raw.startsWith("data:")
        ? `data:image/png;base64,${base64Raw}`
        : base64Raw;

    return {
      base64,
      code: data?.code ?? data?.qrcode?.code ?? null,
      pairingCode: data?.pairingCode ?? data?.qrcode?.pairingCode ?? null,
      count: data?.count,
    };
  }

  async getPairingCode(instanceName: string, phoneNumber: string): Promise<{ pairingCode: string | null }> {
    const digits = onlyDigits(phoneNumber);
    if (!digits) {
      throw new EvolutionApiError("Informe um número de telefone válido com DDI e DDD.");
    }
    const data = await this.request<{
      pairingCode?: string;
      code?: string;
      qrcode?: { pairingCode?: string };
    }>(
      `/instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(digits)}`,
      { method: "GET" },
    );

    return {
      pairingCode: data?.pairingCode ?? data?.qrcode?.pairingCode ?? null,
    };
  }

  async setWebhook(instanceName: string, webhookUrl: string): Promise<unknown> {
    return this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: true,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
          ],
        },
      }),
    });
  }

  async logout(instanceName: string): Promise<unknown> {
    return this.request(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
    });
  }

  async sendText(instanceName: string, toPhoneOrJid: string, text: string): Promise<unknown> {
    const isJid = toPhoneOrJid.includes("@");
    const sanitized = isJid ? toPhoneOrJid.trim() : onlyDigits(toPhoneOrJid);
    if (!sanitized) {
      throw new EvolutionApiError("Número de telefone de destino inválido. Informe o número com DDI e DDD.");
    }
    return this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: sanitized,
        text,
      }),
    });
  }

  /**
   * Aplica configurações de alta estabilidade na instância:
   * - alwaysOnline: true (keep-alive contínuo que impede que o WhatsApp encerre a sessão socket por inatividade)
   * - syncFullHistory: false (previne vazamento de memória e crash)
   * - rejectCall: false, groupsIgnore: false, readMessages: false, readStatus: false
   */
  async applyStabilitySettings(instanceName: string): Promise<unknown> {
    return this.request(`/settings/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        rejectCall: false,
        msgCall: "",
        groupsIgnore: false,
        alwaysOnline: true,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
      }),
    });
  }

  /**
   * Reinicia o socket da instância no servidor da Evolution sem apagar chaves de sessão.
   */
  async restartInstance(instanceName: string): Promise<unknown> {
    return this.request(`/instance/restart/${encodeURIComponent(instanceName)}`, {
      method: "POST",
    });
  }

  /**
   * Tenta reconectar a sessão existente silenciosamente (sem exigir nova leitura de QR Code).
   */
  async tryAutoReconnect(instanceName: string): Promise<EvolutionStateResult> {
    try {
      await this.request(`/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: "GET",
      });
    } catch {
      // silencioso
    }

    try {
      await this.restartInstance(instanceName);
    } catch {
      // silencioso
    }

    // Pequena pausa para o socket Baileys negociar o handshake com os servidores da Meta
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return this.fetchConnectionState(instanceName);
  }
}

