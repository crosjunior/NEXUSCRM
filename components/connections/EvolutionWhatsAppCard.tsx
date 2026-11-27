"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Key,
  LinkIcon,
  PaperPlaneTilt,
  Plugs,
  QrCode,
  ShieldCheck,
  SignOut,
  Warning,
} from "@/lib/ui/icons";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  ActiveWhatsappConnection,
  ConnectionEngine,
  WhatsappConnectionsSettings,
} from "@/lib/channels/evolution/types";
import {
  CONEXAO_OFICIAL,
  ENGINE_ALTERNATIVO,
  ENGINE_EVOLUTION,
  ROTULO_CONEXAO_ATIVA,
  ROTULO_MOTOR_QR,
} from "@/lib/channels/evolution/ui-labels";
import { CanalOficialClient } from "./CanalOficialClient";

type ClientConnections = Omit<WhatsappConnectionsSettings, "evolution"> & {
  evolution: Omit<WhatsappConnectionsSettings["evolution"], "api_key"> & {
    has_api_key: boolean;
    manager_url: string;
  };
};

interface ProviderConfigResponse {
  connections: ClientConnections;
  company_name: string;
  suggested_instance_name: string;
  alt_qr_connected: boolean;
  meta_connected: boolean;
}

const QR_REFRESH_SECONDS = 30;

export function EvolutionWhatsAppCard({
  onEngineChange,
}: {
  onEngineChange?: (engine: ConnectionEngine) => void;
}) {
  const [data, setData] = useState<ProviderConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Modal QR Code
  const [qrOpen, setQrOpen] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(QR_REFRESH_SECONDS);

  // Modal Código de Pareamento (8 dígitos)
  const [pairOpen, setPairOpen] = useState(false);
  const [pairPhone, setPairPhone] = useState("");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairLoading, setPairLoading] = useState(false);

  // Modal Editar Credenciais / Instância
  const [editOpen, setEditOpen] = useState(false);
  const [editInstance, setEditInstance] = useState("");
  const [editServer, setEditServer] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editApiKey, setEditApiKey] = useState("");

  // Modal Teste de Mensagem
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Seção recolhível da Meta Cloud API
  const [metaExpanded, setMetaExpanded] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const envelope = await apiClient.get<{ data: ProviderConfigResponse }>(
        "/api/v1/connections/provider-config",
      );
      const res = envelope?.data;
      if (res?.connections) {
        setData(res);
        onEngineChange?.(res.connections.qr_engine);
        setPairPhone((prev) => prev || res.connections.evolution.phone_number);
      }
    } catch {
      // Silencioso em caso de erro transitório de inicialização
    } finally {
      setLoading(false);
    }
  }, [onEngineChange]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const fetchQr = useCallback(async () => {
    setQrLoading(true);
    try {
      const envelope = await apiClient.post<{
        data: {
          base64: string | null;
          code: string | null;
          pairingCode: string | null;
          instance_name: string;
        };
      }>("/api/v1/connections/evolution/action", { action: "qr" });
      const res = envelope.data;
      setQrBase64(res.base64);
      setQrCountdown(QR_REFRESH_SECONDS);
      if (!res.base64) {
        toast.info("Instância já conectada ou aguardando geração do QR Code.");
      }
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Erro ao gerar QR Code na Evolution API.");
    } finally {
      setQrLoading(false);
    }
  }, [loadConfig]);

  // Contador automático de atualização do QR Code enquanto o modal estiver aberto
  useEffect(() => {
    if (!qrOpen) return;
    const timer = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          void fetchQr();
          return QR_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [qrOpen, fetchQr]);

  async function patchConfig(patch: Record<string, unknown>, successMsg: string) {
    setBusy("patch");
    try {
      await apiClient.patch("/api/v1/connections/provider-config", patch);
      toast.success(successMsg);
      await loadConfig();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não foi possível salvar a alteração.");
    } finally {
      setBusy(null);
    }
  }

  async function runEvoAction(
    action: string,
    payload: Record<string, unknown> = {},
    successMsg?: string,
  ) {
    setBusy(action);
    try {
      const envelope = await apiClient.post<{ data: Record<string, unknown> }>(
        "/api/v1/connections/evolution/action",
        { action, ...payload },
      );
      if (successMsg) toast.success(successMsg);
      await loadConfig();
      return envelope.data;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Falha na operação da Evolution API.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleSendTestMessage() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const envelope = await apiClient.post<{ data: { success: boolean; to_phone: string } }>(
        "/api/v1/connections/evolution/action",
        {
          action: "send_test_message",
          phone_number: testPhone.trim() || undefined,
          message_text: testMessage.trim() || undefined,
        },
      );
      if (envelope.data?.success) {
        setTestResult(`Mensagem enviada com sucesso para ${envelope.data.to_phone}!`);
        toast.success("Mensagem de teste enviada com sucesso!");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Erro ao enviar mensagem de teste.";
      setTestResult(`Falha no envio: ${msg}`);
      toast.error(msg);
      await loadConfig();
    } finally {
      setTestLoading(false);
    }
  }

  async function handleGeneratePairingCode() {
    setPairLoading(true);
    setPairCode(null);
    try {
      const envelope = await apiClient.post<{ data: { pairingCode: string | null } }>(
        "/api/v1/connections/evolution/action",
        { action: "pairing_code", phone_number: pairPhone },
      );
      const res = envelope.data;
      if (res.pairingCode) {
        setPairCode(res.pairingCode);
        toast.success("Código de pareamento de 8 dígitos gerado!");
      } else {
        toast.warning("A Evolution API não retornou código de pareamento para esta instância.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Erro ao gerar código de pareamento.");
    } finally {
      setPairLoading(false);
    }
  }

  if (loading || !data?.connections) {
    return (
      <Card className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" />
        Carregando configuração de conexões...
      </Card>
    );
  }

  const { connections, suggested_instance_name, alt_qr_connected, meta_connected } = data;
  const evo = connections.evolution;
  const activeConn = connections.active_connection;
  const qrEngine = connections.qr_engine;

  const isEvoConnected = evo.status === "connected";
  const isEvoActive = activeConn === ENGINE_EVOLUTION;

  const allConnections: {
    id: ActiveWhatsappConnection;
    label: string;
    connected: boolean;
    active: boolean;
  }[] = [
    {
      id: ENGINE_EVOLUTION,
      label: ROTULO_CONEXAO_ATIVA[ENGINE_EVOLUTION],
      connected: isEvoConnected,
      active: activeConn === ENGINE_EVOLUTION,
    },
    {
      id: ENGINE_ALTERNATIVO,
      label: ROTULO_CONEXAO_ATIVA[ENGINE_ALTERNATIVO],
      connected: alt_qr_connected,
      active: activeConn === ENGINE_ALTERNATIVO,
    },
    {
      id: CONEXAO_OFICIAL,
      label: ROTULO_CONEXAO_ATIVA[CONEXAO_OFICIAL],
      connected: meta_connected,
      active: activeConn === CONEXAO_OFICIAL,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Controle de Conexão Ativa Única + Troca Automática (Admin) */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-emerald-500" />
              <h2 className="text-sm font-semibold">
                Política de Conexão Ativa & Troca Automática (Admin)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Você pode manter múltiplas integrações configuradas, mas apenas{" "}
              <strong>uma conexão fica ativa</strong> por vez. As demais permanecem em standby.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-lg border px-3 py-2 bg-muted/30">
            <div className="space-y-0.5">
              <Label htmlFor="auto-failover" className="text-xs font-medium cursor-pointer">
                Troca automática em caso de falha
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Alterna automaticamente se a conexão ativa cair
              </p>
            </div>
            <Switch
              id="auto-failover"
              checked={connections.auto_failover}
              disabled={busy !== null}
              onCheckedChange={(checked) =>
                void patchConfig(
                  { auto_failover: checked },
                  checked
                    ? "Troca automática de conexão ativada."
                    : "Troca automática de conexão desativada.",
                )
              }
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {allConnections.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                item.active ? "border-emerald-500/50 bg-emerald-500/5" : "bg-card"
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.active ? (
                    <Badge className="bg-emerald-600 text-white text-[10px]">Ativa</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Inativa
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.connected ? "Conectada / pronta" : "Aguardando conexão"}
                </p>
              </div>
              <Button
                size="sm"
                variant={item.active ? "secondary" : "outline"}
                disabled={item.active || busy !== null}
                onClick={() =>
                  void patchConfig(
                    { active_connection: item.id },
                    `${item.label} definida como conexão ativa.`,
                  )
                }
              >
                {item.active ? "Em uso" : "Ativar"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Seletor de Motor QR: Evolution API (Padrão) vs Alternativo (exclusividade mútua) */}
      <Card className="p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Motor de Conexão por QR Code</h3>
            <p className="text-xs text-muted-foreground">
              Evolution API é o padrão. Para conectar um motor QR, é necessário desconectar o outro.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {([ENGINE_EVOLUTION, ENGINE_ALTERNATIVO] as ConnectionEngine[]).map((engine) => {
            const selected = qrEngine === engine;
            const info = ROTULO_MOTOR_QR[engine];
            const blockedByOther =
              (engine === ENGINE_ALTERNATIVO && isEvoConnected) ||
              (engine === ENGINE_EVOLUTION && alt_qr_connected);

            return (
              <div
                key={engine}
                className={`rounded-lg border p-4 flex flex-col justify-between gap-3 ${
                  selected ? "border-primary bg-primary/5" : "bg-card"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{info.titulo}</span>
                    {selected && <Badge variant="default">Selecionado</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{info.subtitulo}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {blockedByOther && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Warning size={12} />
                      Desconecte o outro motor para alternar
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    className="ml-auto"
                    disabled={selected || busy !== null}
                    onClick={() =>
                      void patchConfig(
                        { qr_engine: engine },
                        `Motor QR alterado para ${info.titulo}.`,
                      )
                    }
                  >
                    {selected ? "Selecionado" : "Usar este motor"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 3. Card Interativo WhatsApp (Evolution API) */}
      {qrEngine === ENGINE_EVOLUTION && (
        <Card className="p-6 space-y-5 border-emerald-500/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Plugs size={20} className="text-emerald-500" />
                <h2 className="text-base font-semibold">WhatsApp (Evolution API)</h2>
                <Badge
                  variant={isEvoConnected ? "default" : "secondary"}
                  className={isEvoConnected ? "bg-emerald-600 text-white" : undefined}
                >
                  {isEvoConnected
                    ? "Conectada"
                    : evo.status === "connecting"
                      ? "Conectando"
                      : "Desconectada"}
                </Badge>
                {isEvoActive && (
                  <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                    Conexão Ativa
                  </Badge>
                )}
                <Badge variant="outline" className="border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10 text-[11px]">
                  Always Online (Keep-Alive)
                </Badge>
                <Badge variant="outline" className="border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[11px]">
                  Auto-Reconexão Automática
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Gerenciamento automático de instância pela aplicação com QR Code, pareamento de 8
                dígitos e webhook sincronizado.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditInstance(evo.instance_name);
                  setEditServer(evo.server_url);
                  setEditPhone(evo.phone_number);
                  setEditApiKey("");
                  setEditOpen(true);
                }}
              >
                Configurar Instância
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={evo.manager_url} target="_blank" rel="noopener noreferrer">
                  <LinkIcon size={14} className="mr-1.5" />
                  Evolution Manager
                </a>
              </Button>
            </div>
          </div>

          {/* Metadados da Instância Conectada */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Instância Conectada
              </p>
              <p className="mt-1 text-sm font-semibold">{evo.instance_name}</p>
              {evo.instance_name !== suggested_instance_name && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-primary hover:underline"
                  onClick={() =>
                    void runEvoAction(
                      "use_company_instance",
                      {},
                      `Instância definida para o nome da empresa (${suggested_instance_name}).`,
                    )
                  }
                >
                  Usar nome da empresa ({suggested_instance_name})
                </button>
              )}
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Canal</p>
              <p className="mt-1 text-sm font-semibold">{evo.channel}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Número</p>
              <p className="mt-1 text-sm font-semibold">{evo.phone_number}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Servidor</p>
              <p className="mt-1 text-sm font-semibold truncate" title={evo.server_url}>
                {evo.server_url}
              </p>
            </div>
          </div>

          {/* Funcionalidades Ativas */}
          <div className="rounded-lg border bg-muted/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle size={15} className="text-emerald-500" />
                <span>
                  Webhook registrado:{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5">{evo.webhook_url}</code>
                </span>
                {evo.webhook_synced && (
                  <Badge variant="secondary" className="text-[10px]">
                    Sincronizado
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void runEvoAction(
                    "sync_webhook",
                    {},
                    "Webhook /api/webhooks/evolution sincronizado na instância!",
                  )
                }
              >
                {busy === "sync_webhook" ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <ArrowsClockwise size={14} className="mr-1.5" />
                )}
                Sincronizar Webhook
              </Button>
            </div>

            {!evo.has_api_key && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <span>
                  Falta informar a <strong>API Key</strong> do servidor Evolution (
                  <code>{evo.server_url}</code>) para autenticar ações nesta instância.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditInstance(evo.instance_name);
                    setEditServer(evo.server_url);
                    setEditPhone(evo.phone_number);
                    setEditApiKey("");
                    setEditOpen(true);
                  }}
                >
                  Informar API Key
                </Button>
              </div>
            )}

            {evo.last_error && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Último aviso da API: {evo.last_error}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => {
                  setQrOpen(true);
                  void fetchQr();
                }}
              >
                <QrCode size={15} className="mr-1.5" />
                Conexão via QR Code
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPairCode(null);
                  setPairOpen(true);
                }}
              >
                <Key size={15} className="mr-1.5" />
                Código de Pareamento (8 dígitos)
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void runEvoAction(
                    "auto_reconnect",
                    {},
                    "Tentativa de reconexão de sessão salva concluída.",
                  )
                }
                title="Tenta reconectar o socket da sessão salva no Baileys sem ler QR Code"
              >
                {busy === "auto_reconnect" ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <ArrowsClockwise size={14} className="mr-1.5" />
                )}
                Reconectar Sessão Salva (Sem QR)
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void runEvoAction(
                    "apply_stability",
                    {},
                    "Modo Always Online e keep-alive contínuo ativados com sucesso!",
                  )
                }
                title="Ativa Always Online e previne timeout de inatividade"
              >
                {busy === "apply_stability" ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <ShieldCheck size={14} className="mr-1.5 text-sky-500" />
                )}
                Otimizar Estabilidade
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void runEvoAction("check_status", {}, "Status da instância verificado.")
                }
              >
                {busy === "check_status" ? (
                  <CircleNotch size={14} className="animate-spin mr-1.5" />
                ) : (
                  <ArrowsClockwise size={14} className="mr-1.5" />
                )}
                Verificar Status
              </Button>

              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setTestPhone(evo.phone_number || "");
                  setTestMessage(
                    `*NexusCRM - Teste de Envio*\nInstância: ${evo.instance_name}\nData: ${new Date().toLocaleString("pt-BR")}`,
                  );
                  setTestResult(null);
                  setTestOpen(true);
                }}
              >
                <PaperPlaneTilt size={15} className="mr-1.5" />
                Testar Envio / Recebimento
              </Button>

              {isEvoConnected && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() =>
                    void runEvoAction("disconnect", {}, "Instância Evolution API desconectada.")
                  }
                >
                  <SignOut size={14} className="mr-1.5" />
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 4. Seção recolhível: WhatsApp Meta Cloud API (Opção Secundária / Avançada) */}
      <Card className="p-4">
        <button
          type="button"
          onClick={() => setMetaExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h3 className="text-sm font-semibold">
              WhatsApp Meta Cloud API (Opção Secundária / Avançada)
            </h3>
            <p className="text-xs text-muted-foreground">
              {metaExpanded
                ? "Clique para recolher as configurações da API Oficial da Meta."
                : "Clique para expandir e configurar a API Oficial da Meta como conexão principal ou backup."}
            </p>
          </div>
          <Badge variant="outline">{metaExpanded ? "Recolher" : "Expandir"}</Badge>
        </button>
        {metaExpanded && (
          <div className="mt-4 border-t pt-4">
            <CanalOficialClient />
          </div>
        )}
      </Card>

      {/* Modal: QR Code base64 com contador automático */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Conectar via QR Code (Evolution API)</DialogTitle>
            <DialogDescription>
              Escaneie com o WhatsApp do aparelho na instância{" "}
              <strong>{evo.instance_name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrLoading ? (
              <div className="flex h-60 w-60 items-center justify-center rounded-lg border bg-muted/30">
                <CircleNotch size={28} className="animate-spin text-muted-foreground" />
              </div>
            ) : qrBase64 ? (
              <img
                src={qrBase64}
                alt="QR Code Evolution API"
                className="h-60 w-60 rounded-lg border bg-white p-2"
              />
            ) : (
              <div className="flex h-60 w-60 flex-col items-center justify-center rounded-lg border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                Nenhum QR Code retornado no momento. Verifique se a instância já está conectada ou
                clique em atualizar.
              </div>
            )}
            <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
              <span>Atualização automática em {qrCountdown}s</span>
              <Button size="sm" variant="outline" disabled={qrLoading} onClick={() => void fetchQr()}>
                Atualizar agora
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Código de Pareamento (8 dígitos) */}
      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conexão via Código de Pareamento</DialogTitle>
            <DialogDescription>
              Gera o código de 8 dígitos na Evolution API para parear diretamente pelo número no
              celular.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pair-phone">Número com DDI e DDD</Label>
              <Input
                id="pair-phone"
                value={pairPhone}
                onChange={(e) => setPairPhone(e.target.value)}
                placeholder="+55 (11) 99999-9999"
              />
            </div>

            {pairCode && (
              <div className="rounded-lg border bg-emerald-500/10 p-4 text-center">
                <p className="text-xs text-muted-foreground">Digite este código no seu WhatsApp:</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-emerald-600">
                  {pairCode}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPairOpen(false)}>
                Fechar
              </Button>
              <Button disabled={pairLoading || !pairPhone.trim()} onClick={handleGeneratePairingCode}>
                {pairLoading && <CircleNotch size={14} className="animate-spin mr-1.5" />}
                Gerar código de 8 dígitos
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Teste de Envio e Recebimento de Mensagem */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Testar Envio / Recebimento de Mensagem</DialogTitle>
            <DialogDescription>
              Dispare uma mensagem direta pela instância <strong>{evo.instance_name}</strong> via Evolution API para verificar o canal ativo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="test-phone">Número de Destino (com DDI e DDD)</Label>
              <Input
                id="test-phone"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+55 (11) 99999-9999"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-msg">Texto da Mensagem</Label>
              <textarea
                id="test-msg"
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
            </div>

            {testResult && (
              <div
                className={`space-y-2 rounded-lg border p-3 text-xs ${
                  testResult.startsWith("Mensagem enviada")
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                <p>{testResult}</p>
                {testResult.toLowerCase().includes("desconectad") && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setTestOpen(false);
                        setQrOpen(true);
                        void fetchQr();
                      }}
                    >
                      <QrCode size={13} className="mr-1.5" />
                      Reconectar via QR Code
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setTestOpen(false);
                        setPairCode(null);
                        setPairOpen(true);
                      }}
                    >
                      <Key size={13} className="mr-1.5" />
                      Pareamento (8 dígitos)
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setTestOpen(false)}>
                Fechar
              </Button>
              <Button disabled={testLoading || !testPhone.trim()} onClick={handleSendTestMessage}>
                {testLoading && <CircleNotch size={14} className="animate-spin mr-1.5" />}
                Enviar Mensagem de Teste
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Configurar Instância / Servidor Evolution */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Instância Evolution API</DialogTitle>
            <DialogDescription>
              Gerencie servidor, nome da instância (ex.: nome da empresa) e chave de acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Nome da Instância</Label>
              <Input value={editInstance} onChange={(e) => setEditInstance(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>URL do Servidor</Label>
              <Input value={editServer} onChange={(e) => setEditServer(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Número</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>API Key (opcional se configurada no ambiente)</Label>
              <Input
                type="password"
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                placeholder={evo.has_api_key ? "•••••••• (mantida)" : "Cole a apikey do servidor"}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={busy !== null}
                onClick={async () => {
                  await patchConfig(
                    {
                      evolution: {
                        instance_name: editInstance,
                        server_url: editServer,
                        phone_number: editPhone,
                        ...(editApiKey.trim() ? { api_key: editApiKey.trim() } : {}),
                      },
                    },
                    "Configuração da Evolution API salva!",
                  );
                  setEditOpen(false);
                }}
              >
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
