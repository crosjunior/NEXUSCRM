import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActiveWhatsappConnection,
  ConnectionEngine,
  EvolutionInstanceSettings,
  WhatsappConnectionsSettings,
} from "./types";

export const DEFAULT_EVOLUTION_SERVER_URL = "https://evol.nexusia.work";
export const DEFAULT_EVOLUTION_INSTANCE_NAME = "NexusReplay";
export const DEFAULT_EVOLUTION_INSTANCE_ID = "1fe77663-64a4-412e-b088-06b84486a74c";
export const DEFAULT_EVOLUTION_PHONE = "+55 (34) 95330-9898";
export const EVOLUTION_WEBHOOK_PATH = "/api/webhooks/evolution";

export function buildEvolutionManagerUrl(serverUrl: string, instanceId: string): string {
  const base = serverUrl.trim().replace(/\/+$/, "");
  return `${base}/manager/instance/${encodeURIComponent(instanceId)}`;
}

export function generateCompanyInstanceName(companyName: string): string {
  const clean = companyName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .trim();
  return clean || "NexusCRM";
}

export function defaultWhatsappConnectionsSettings(): WhatsappConnectionsSettings {
  return {
    qr_engine: "evolution",
    active_connection: "evolution",
    auto_failover: true,
    evolution: {
      instance_name: DEFAULT_EVOLUTION_INSTANCE_NAME,
      instance_id: DEFAULT_EVOLUTION_INSTANCE_ID,
      server_url: DEFAULT_EVOLUTION_SERVER_URL,
      api_key: null,
      channel: "Baileys",
      phone_number: DEFAULT_EVOLUTION_PHONE,
      status: "connected",
      webhook_url: EVOLUTION_WEBHOOK_PATH,
      webhook_synced: true,
      last_checked_at: null,
      last_error: null,
    },
    last_failover_at: null,
    last_failover_reason: null,
  };
}

export function mergeWhatsappConnectionsSettings(
  rawSettings: unknown,
): WhatsappConnectionsSettings {
  const defaults = defaultWhatsappConnectionsSettings();
  const root =
    rawSettings && typeof rawSettings === "object"
      ? (rawSettings as Record<string, unknown>)
      : {};
  const wc =
    root.whatsapp_connections && typeof root.whatsapp_connections === "object"
      ? (root.whatsapp_connections as Record<string, unknown>)
      : {};
  const evo =
    wc.evolution && typeof wc.evolution === "object"
      ? (wc.evolution as Record<string, unknown>)
      : {};

  const qrEngine: ConnectionEngine = wc.qr_engine === "waha" ? "waha" : "evolution";
  const activeConnection: ActiveWhatsappConnection =
    wc.active_connection === "waha" || wc.active_connection === "meta_cloud"
      ? wc.active_connection
      : "evolution";

  const statusRaw = evo.status;
  const status: EvolutionInstanceSettings["status"] =
    statusRaw === "connected" ||
    statusRaw === "connecting" ||
    statusRaw === "disconnected" ||
    statusRaw === "error"
      ? statusRaw
      : defaults.evolution.status;

  return {
    qr_engine: qrEngine,
    active_connection: activeConnection,
    auto_failover: typeof wc.auto_failover === "boolean" ? wc.auto_failover : defaults.auto_failover,
    evolution: {
      instance_name:
        typeof evo.instance_name === "string" && evo.instance_name.trim()
          ? evo.instance_name.trim()
          : defaults.evolution.instance_name,
      instance_id:
        typeof evo.instance_id === "string" && evo.instance_id.trim()
          ? evo.instance_id.trim()
          : defaults.evolution.instance_id,
      server_url:
        typeof evo.server_url === "string" && evo.server_url.trim()
          ? evo.server_url.trim()
          : defaults.evolution.server_url,
      api_key: typeof evo.api_key === "string" && evo.api_key.trim() ? evo.api_key.trim() : null,
      channel: "Baileys",
      phone_number:
        typeof evo.phone_number === "string" && evo.phone_number.trim()
          ? evo.phone_number.trim()
          : defaults.evolution.phone_number,
      status,
      webhook_url:
        typeof evo.webhook_url === "string" && evo.webhook_url.trim()
          ? evo.webhook_url.trim()
          : defaults.evolution.webhook_url,
      webhook_synced:
        typeof evo.webhook_synced === "boolean"
          ? evo.webhook_synced
          : defaults.evolution.webhook_synced,
      last_checked_at: typeof evo.last_checked_at === "string" ? evo.last_checked_at : null,
      last_error: typeof evo.last_error === "string" ? evo.last_error : null,
    },
    last_failover_at: typeof wc.last_failover_at === "string" ? wc.last_failover_at : null,
    last_failover_reason:
      typeof wc.last_failover_reason === "string" ? wc.last_failover_reason : null,
  };
}

export async function loadOrgWhatsappConnections(
  admin: SupabaseClient,
  orgId: string,
): Promise<{
  displayName: string;
  settings: Record<string, unknown>;
  connections: WhatsappConnectionsSettings;
}> {
  const { data, error } = await admin
    .from("organizations")
    .select("display_name, settings")
    .eq("id", orgId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "organization_not_found");
  }

  const rawSettings = (data.settings ?? {}) as Record<string, unknown>;
  return {
    displayName: data.display_name ?? "Minha Empresa",
    settings: rawSettings,
    connections: mergeWhatsappConnectionsSettings(rawSettings),
  };
}

export async function syncEvolutionVirtualChannelSession(
  admin: SupabaseClient,
  orgId: string,
  connections: WhatsappConnectionsSettings,
): Promise<string | null> {
  const sessionName = `evolution_${connections.evolution.instance_name}`;
  const isEvoWorking =
    connections.qr_engine === "evolution" && connections.evolution.status === "connected";

  const { data: existing } = await admin
    .from("channel_sessions")
    .select("id, status, phone_number, display_name")
    .eq("organization_id", orgId)
    .eq("waha_session_name", sessionName)
    .maybeSingle();

  if (isEvoWorking) {
    const rawPhone = connections.evolution.phone_number;
    const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, "") : "";
    const phoneFormatted = cleanPhone ? (cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`) : null;
    const displayName = `${connections.evolution.instance_name} (Evolution API)`;

    if (existing) {
      if (existing.status !== "WORKING" || existing.phone_number !== phoneFormatted) {
        await admin
          .from("channel_sessions")
          .update({
            status: "WORKING",
            phone_number: phoneFormatted,
            display_name: displayName,
            archived_at: null,
          })
          .eq("id", existing.id);
      }
      return existing.id;
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("channel_sessions")
        .insert({
          organization_id: orgId,
          provider: "waha",
          waha_session_name: sessionName,
          display_name: displayName,
          phone_number: phoneFormatted,
          status: "WORKING",
          webhook_secret_encrypted: "\\x00",
        })
        .select("id")
        .single();

      if (!insertError && inserted) {
        return inserted.id;
      }
    }
  } else if (existing && existing.status === "WORKING") {
    await admin
      .from("channel_sessions")
      .update({
        status: "STOPPED",
      })
      .eq("id", existing.id);
  }

  return existing?.id ?? null;
}

export async function saveOrgWhatsappConnections(
  admin: SupabaseClient,
  orgId: string,
  baseSettings: Record<string, unknown>,
  nextConnections: WhatsappConnectionsSettings,
): Promise<void> {
  const nextSettings = {
    ...baseSettings,
    whatsapp_connections: nextConnections,
  };
  const { error } = await admin
    .from("organizations")
    .update({ settings: nextSettings })
    .eq("id", orgId);

  if (error) {
    throw new Error(error.message);
  }

  try {
    await syncEvolutionVirtualChannelSession(admin, orgId, nextConnections);
  } catch (err) {
    // Best effort sync para não quebrar a escrita
    console.warn("[evolution.syncVirtualSession] Falha ao sincronizar canal virtual:", err);
  }
}

export async function hasConnectedSessionForProvider(
  admin: SupabaseClient,
  orgId: string,
  provider: "waha" | "meta_cloud",
): Promise<boolean> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .is("archived_at", null);

  return (data ?? []).some((s) => s.status === "connected" || s.status === "connecting");
}

export async function hasConnectedAlternativeQrSession(
  admin: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  return hasConnectedSessionForProvider(admin, orgId, "waha");
}

export async function hasConnectedOfficialSession(
  admin: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  return hasConnectedSessionForProvider(admin, orgId, "meta_cloud");
}

export async function triggerFailoverIfEnabled(
  admin: SupabaseClient,
  orgId: string,
  failedConnection: ActiveWhatsappConnection,
  reason: string,
): Promise<ActiveWhatsappConnection | null> {
  const { settings, connections } = await loadOrgWhatsappConnections(admin, orgId);
  if (!connections.auto_failover) return null;
  if (connections.active_connection !== failedConnection) return null;

  const candidates: ActiveWhatsappConnection[] = (
    ["evolution", "waha", "meta_cloud"] as ActiveWhatsappConnection[]
  ).filter((c) => c !== failedConnection);

  for (const candidate of candidates) {
    if (candidate === "evolution" && connections.evolution.status === "connected") {
      const updated: WhatsappConnectionsSettings = {
        ...connections,
        active_connection: "evolution",
        last_failover_at: new Date().toISOString(),
        last_failover_reason: reason,
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, updated);
      return "evolution";
    }
    if (
      (candidate === "waha" || candidate === "meta_cloud") &&
      (await hasConnectedSessionForProvider(admin, orgId, candidate))
    ) {
      const updated: WhatsappConnectionsSettings = {
        ...connections,
        active_connection: candidate,
        last_failover_at: new Date().toISOString(),
        last_failover_reason: reason,
      };
      await saveOrgWhatsappConnections(admin, orgId, settings, updated);
      return candidate;
    }
  }

  return null;
}
