export type ConnectionEngine = "evolution" | "waha";
export type ActiveWhatsappConnection = "evolution" | "waha" | "meta_cloud";
export type EvolutionConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

export interface EvolutionInstanceSettings {
  instance_name: string;
  instance_id: string;
  server_url: string;
  api_key: string | null;
  channel: "Baileys";
  phone_number: string;
  status: EvolutionConnectionStatus;
  webhook_url: string;
  webhook_synced: boolean;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface WhatsappConnectionsSettings {
  qr_engine: ConnectionEngine;
  active_connection: ActiveWhatsappConnection;
  auto_failover: boolean;
  evolution: EvolutionInstanceSettings;
  last_failover_at: string | null;
  last_failover_reason: string | null;
}

