"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Workflow,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Bot,
  Copy,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { copyToClipboard as copyTextToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";
import type {
  InstagramKeywordRule,
  InstagramMediaItem,
  InstagramRuleExecutionLog,
} from "@/lib/channels/instagram/types";

interface InstagramState {
  connected: boolean;
  account: {
    id: string;
    accountId: string;
    username: string;
    name?: string | null;
    profilePicture?: string | null;
  } | null;
  agent_id: string | null;
  keyword_rules: InstagramKeywordRule[];
  rule_executions?: InstagramRuleExecutionLog[];
  media_items: InstagramMediaItem[];
  available_agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
  webhook_url: string;
  webhook_verify_token: string;
  oauth_redirect_uri?: string;
}

export function InstagramDirectCard() {
  const t = useT();
  const qc = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const { data: state, isLoading, isError } = useQuery<InstagramState>({
    queryKey: ["instagram-channel-state"],
    queryFn: async () => {
      const res = await fetch("/api/v1/channels/instagram");
      if (!res.ok) throw new Error("Falha ao carregar estado do canal Instagram.");
      const json = await res.json();
      return json.data;
    },
    staleTime: 10_000,
  });

  const saveAgentMutation = useMutation({
    mutationFn: async (agentId: string | null) => {
      const res = await fetch("/api/v1/channels/instagram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) throw new Error("Falha ao atualizar agente de IA.");
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("Agente vinculado com sucesso!"));
      qc.invalidateQueries({ queryKey: ["instagram-channel-state"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("Erro ao salvar agente."));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/channels/instagram", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Falha ao desconectar conta.");
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("Conta do Instagram desconectada."));
      qc.invalidateQueries({ queryKey: ["instagram-channel-state"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("Erro ao desconectar."));
    },
  });

  const isConnected = Boolean(state?.connected);
  const account = state?.account;
  const rules = state?.keyword_rules || [];

  function copyToClipboard(val: string, label: string) {
    copyTextToClipboard(val);
    toast.success(`${label} ${t("copiado para a área de transferência!")}`);
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-10 w-10 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-40 bg-muted rounded" />
            <div className="h-3 w-64 bg-muted rounded" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-6">
      {/* Header do Canal */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white shadow-md">
            <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Instagram Direct & Comentários</h3>
              {isConnected ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {t("Conectado")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {t("Não Conectado")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("Conexão nativa sem taxas por mensagem. Atenda DMs com IA e automatize respostas a comentários e stories.")}
            </p>
          </div>
        </div>

        <div>
          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? t("Desconectando...") : t("Desconectar")}
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium"
              onClick={() => {
                window.location.href = "/api/v1/channels/instagram/connect";
              }}
            >
              {t("Conectar Instagram")}
            </Button>
          )}
        </div>
      </div>

      {/* Conta Conectada */}
      {isConnected && account && (
        <div className="flex items-center justify-between rounded-xl border p-4 bg-muted/20">
          <div className="flex items-center gap-3">
            {account.profilePicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.profilePicture}
                alt=""
                className="h-10 w-10 rounded-full border object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 text-white font-bold text-sm">
                @{account.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">@{account.username}</p>
              <p className="text-xs text-muted-foreground">
                {account.name ? `${account.name} · ` : ""}ID: {account.accountId}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Vínculo com Agente de IA para DMs Gerais */}
      {isConnected && (
        <div className="space-y-3 rounded-xl border p-4 bg-muted/10">
          <div>
            <h4 className="text-sm font-semibold">{t("Atendimento Automático com Agente de IA")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("Escolha qual Agente de IA irá atender e responder às conversas recebidas nas DMs do Instagram.")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="flex-1 rounded-md border bg-background p-2 text-sm"
              value={selectedAgentId || state.agent_id || ""}
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              <option value="">{t("Nenhum (Somente Atendimento Humano ou Automações)")}</option>
              {state.available_agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.role}) {ag.status === "published" ? "✓ Ativo" : ""}
                </option>
              ))}
            </select>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => saveAgentMutation.mutate(selectedAgentId || state.agent_id || null)}
              disabled={saveAgentMutation.isPending}
            >
              {saveAgentMutation.isPending ? t("Salvando...") : t("Vincular Agente")}
            </Button>
          </div>
        </div>
      )}

      {/* Atalho para a nova página de Fluxos e Automações de Atendimento */}
      {isConnected && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 p-5 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h4 className="text-sm font-semibold text-foreground">
                {t("Fluxos e Automações de Atendimento")}
              </h4>
              <Badge variant="secondary" className="text-[10px]">
                {rules.length} {rules.length === 1 ? t("regra configurada") : t("regras configuradas")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              {t(
                "A criação e edição de fluxos visuais, respostas a posts/reels, stories e acompanhamento de métricas agora possuem uma página exclusiva.",
              )}
            </p>
          </div>

          <Link href="/app/flows">
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shrink-0 shadow-sm">
              <Workflow className="h-4 w-4" />
              {t("Gerenciar Fluxos")}
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {/* Dados do Webhook e Callback da Meta */}
      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        <h4 className="text-sm font-semibold">{t("Configuração do Webhook no Meta for Developers")}</h4>
        <p className="text-xs text-muted-foreground">
          {t("Configure este endereço no painel do seu Aplicativo Meta (Webhooks → Instagram):")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-muted-foreground">{t("URL de Retorno de Chamada do Webhook:")}</span>
            <div className="flex items-center gap-2">
              <Input readOnly value={state?.webhook_url || ""} className="font-mono text-xs h-8 bg-background" />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => state?.webhook_url && copyToClipboard(state.webhook_url, "URL do Webhook")}
              >
                {t("Copiar")}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground">{t("Token de Verificação do Webhook:")}</span>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={state?.webhook_verify_token || ""}
                className="font-mono text-xs h-8 bg-background"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => state?.webhook_verify_token && copyToClipboard(state.webhook_verify_token, "Token de Verificação")}
              >
                {t("Copiar")}
              </Button>
            </div>
          </div>

          <div className="space-y-1 md:col-span-2 pt-1 border-t border-border/40">
            <span className="text-muted-foreground font-medium text-amber-500">
              {t("URI de Redirecionamento de OAuth Válido (Meta Login for Business):")}
            </span>
            <p className="text-[11px] text-muted-foreground">
              {t("Adicione exatamente este endereço em: Meta Developers → Seu App → Login do Facebook / Configurações → URIs de redirecionamento do OAuth válidos:")}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Input
                readOnly
                value={state?.oauth_redirect_uri || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/channels/instagram/callback` : "")}
                className="font-mono text-xs h-8 bg-background"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
                onClick={() => {
                  const uri = state?.oauth_redirect_uri || `${window.location.origin}/api/v1/channels/instagram/callback`;
                  copyToClipboard(uri, "URI de Redirecionamento OAuth");
                }}
              >
                {t("Copiar")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
