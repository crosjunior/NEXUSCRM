import type { ActiveWhatsappConnection, ConnectionEngine } from "./types";

export const ENGINE_EVOLUTION: ConnectionEngine = "evolution";
export const ENGINE_ALTERNATIVO: ConnectionEngine = "waha";
export const CONEXAO_OFICIAL: ActiveWhatsappConnection = "meta_cloud";

export const QR_ENGINES = [ENGINE_EVOLUTION, ENGINE_ALTERNATIVO] as const;
export const ACTIVE_CONNECTIONS = [
  ENGINE_EVOLUTION,
  ENGINE_ALTERNATIVO,
  CONEXAO_OFICIAL,
] as const;

export const MSG_DESCONECTAR_EVOLUTION_ANTES =
  "Desconecte a Evolution API antes de alternar para o WAHA.";
export const MSG_DESCONECTAR_ALTERNATIVO_ANTES =
  "Para conectar via Evolution API, desconecte primeiro a sessão ativa do WAHA.";

export const ROTULO_MOTOR_QR: Record<ConnectionEngine, { titulo: string; subtitulo: string }> = {
  evolution: {
    titulo: "Evolution API (Padrão)",
    subtitulo: "Conexão gerenciada via Baileys com QR Code, código de pareamento de 8 dígitos e webhook automático.",
  },
  waha: {
    titulo: "WAHA",
    subtitulo: "Motor alternativo por QR Code (NOWEB). Para conectar, desconecte primeiro a Evolution API.",
  },
};

export const ROTULO_CONEXAO_ATIVA: Record<ActiveWhatsappConnection, string> = {
  evolution: "Evolution API",
  waha: "WAHA",
  meta_cloud: "API Oficial (Meta Cloud)",
};
