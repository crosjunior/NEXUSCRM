"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Workflow, SlidersHorizontal, MessageCircle, Send, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard as copyTextToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  buildManyChatDefaultGraph,
  extractRuleSummaryFromGraph,
} from "@/lib/channels/instagram/flow-engine";
import type {
  InstagramFlowGraph,
  InstagramKeywordRule,
  InstagramMediaItem,
  InstagramRuleExecutionLog,
} from "@/lib/channels/instagram/types";
import { InstagramVisualFlowBuilder } from "./InstagramVisualFlowBuilder";
import { InstagramRuleMetricsModal } from "./InstagramRuleMetricsModal";

interface InstagramState {
  connected: boolean;
  account: {
    id: string;
    accountId: string;
    username: string;
    name: string;
    profile_picture_url: string | null;
    status: string;
    connectedAt: string;
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

function formatMediaDate(iso: string, tagIdioma: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(tagIdioma, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mediaTypeBadgeLabel(productType?: string | null): string {
  if (productType === "REELS") return "REELS";
  if (productType === "STORY") return "STORY";
  return "POST";
}

function getRuleScheduleStatus(rule: InstagramKeywordRule, tagIdioma: string): {
  label: string;
  tone: "emerald" | "amber" | "red" | "muted";
} {
  if (!rule.active) {
    return { label: "Pausada", tone: "muted" };
  }
  if (rule.is_permanent !== false) {
    return { label: "Permanente", tone: "emerald" };
  }
  const now = Date.now();
  if (rule.starts_at) {
    const startMs = Date.parse(rule.starts_at);
    if (!Number.isNaN(startMs) && now < startMs) {
      return { label: `Agendada (inicia ${formatMediaDate(rule.starts_at, tagIdioma)})`, tone: "amber" };
    }
  }
  if (rule.ends_at) {
    const endMs = Date.parse(rule.ends_at);
    if (!Number.isNaN(endMs) && now > endMs) {
      return { label: `Encerrada em ${formatMediaDate(rule.ends_at, tagIdioma)}`, tone: "red" };
    }
    return { label: `Ativa até ${formatMediaDate(rule.ends_at, tagIdioma)}`, tone: "emerald" };
  }
  return { label: "Temporária (em vigor)", tone: "emerald" };
}

export function InstagramDirectCard() {
  const t = useT();
  const tagIdioma = useTagDeIdioma();
  const queryClient = useQueryClient();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [metricsRuleId, setMetricsRuleId] = useState<string | null>(null);

  // Estado do dropdown visual de publicações (Post, Reels, Story)
  const [isMediaDropdownOpen, setIsMediaDropdownOpen] = useState(false);
  const [mediaFilterType, setMediaFilterType] = useState<"ALL" | "FEED" | "REELS" | "STORY">("ALL");

  const [ruleForm, setRuleForm] = useState<{
    name: string;
    mode: "basic" | "visual";
    type: InstagramKeywordRule["type"];
    match: "contains" | "exact";
    rawKeywords: string;
    public_reply: string;
    dm_message: string;
    media_id: string;
    media_caption_preview: string | null;
    media_thumbnail_url: string | null;
    media_product_type: string | null;
    media_permalink: string | null;
    is_permanent: boolean;
    starts_at: string;
    ends_at: string;
    active: boolean;
    flow_graph: InstagramFlowGraph;
  }>({
    name: "",
    mode: "basic",
    type: "comment_keyword",
    match: "contains",
    rawKeywords: "quero, link, preco",
    public_reply: "Te enviei no direct! Dá uma olhada 🚀",
    dm_message: "Olá {username}! Aqui está o link que você pediu: ",
    media_id: "all",
    media_caption_preview: null,
    media_thumbnail_url: null,
    media_product_type: null,
    media_permalink: null,
    is_permanent: true,
    starts_at: "",
    ends_at: "",
    active: true,
    flow_graph: buildManyChatDefaultGraph(),
  });

  const { data: state, isLoading } = useQuery<InstagramState>({
    queryKey: ["instagram-direct-state"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: InstagramState }>("/api/v1/channels/instagram");
      return res.data;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { auth_url: string } }>("/api/v1/channels/instagram", {
        action: "get_connect_url",
      });
      return res.data.auth_url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: Error) => {
      toast.error(err.message || "Não foi possível iniciar conexão com a Meta.");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/api/v1/channels/instagram", { action: "disconnect" });
    },
    onSuccess: () => {
      toast.success("Conta do Instagram desconectada.");
      void queryClient.invalidateQueries({ queryKey: ["instagram-direct-state"] });
      void queryClient.invalidateQueries({ queryKey: ["social-connections"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao desconectar.");
    },
  });

  const saveAgentMutation = useMutation({
    mutationFn: async (agentId: string | null) => {
      await apiClient.post("/api/v1/channels/instagram", {
        action: "set_agent",
        agent_id: agentId,
      });
    },
    onSuccess: () => {
      toast.success("Agente de IA vinculado ao Instagram.");
      void queryClient.invalidateQueries({ queryKey: ["instagram-direct-state"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao vincular agente.");
    },
  });

  const saveRulesMutation = useMutation({
    mutationFn: async (rules: InstagramKeywordRule[]) => {
      await apiClient.post("/api/v1/channels/instagram", {
        action: "save_keywords",
        rules,
      });
    },
    onSuccess: () => {
      toast.success("Regras de automação salvas com sucesso.");
      setIsFormOpen(false);
      setEditingRuleId(null);
      setIsMediaDropdownOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["instagram-direct-state"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao salvar regras.");
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      await apiClient.post("/api/v1/channels/instagram", {
        action: "clear_rule_logs",
        rule_id: ruleId,
      });
    },
    onSuccess: () => {
      toast.success("Histórico de indicadores zerado com sucesso.");
      void queryClient.invalidateQueries({ queryKey: ["instagram-direct-state"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao limpar indicadores.");
    },
  });

  function openNewRuleForm(initialMode: "basic" | "visual" = "basic") {
    setEditingRuleId(null);
    setRuleForm({
      name: "",
      mode: initialMode,
      type: "comment_keyword",
      match: "contains",
      rawKeywords: "quero, link, preco",
      public_reply: "Te enviei no direct! Dá uma olhada 🚀",
      dm_message: "Olá {username}! Aqui está o link que você pediu: ",
      media_id: "all",
      media_caption_preview: null,
      media_thumbnail_url: null,
      media_product_type: null,
      media_permalink: null,
      is_permanent: true,
      starts_at: "",
      ends_at: "",
      active: true,
      flow_graph: buildManyChatDefaultGraph({
        keywords: ["quero", "link"],
        publicReply: "Te enviei no direct! Dá uma olhada 🚀",
      }),
    });
    setIsMediaDropdownOpen(false);
    setIsFormOpen(true);
  }

  function openEditRuleForm(rule: InstagramKeywordRule) {
    setEditingRuleId(rule.id);
    const defaultGraph =
      rule.flow_graph && rule.flow_graph.nodes?.length > 0
        ? rule.flow_graph
        : buildManyChatDefaultGraph({
            keywords: rule.keywords,
            publicReply: rule.public_reply || undefined,
            dmMessage: rule.dm_message,
            mediaId: rule.media_id,
          });

    setRuleForm({
      name: rule.name || "",
      mode: rule.mode === "visual" ? "visual" : "basic",
      type: rule.type || "comment_keyword",
      match: rule.match || "contains",
      rawKeywords: (rule.keywords || []).join(", "),
      public_reply: rule.public_reply || "",
      dm_message: rule.dm_message || "",
      media_id: rule.media_id || "all",
      media_caption_preview: rule.media_caption_preview || null,
      media_thumbnail_url: rule.media_thumbnail_url || null,
      media_product_type: rule.media_product_type || null,
      media_permalink: rule.media_permalink || null,
      is_permanent: rule.is_permanent !== false,
      starts_at: toDatetimeLocalValue(rule.starts_at),
      ends_at: toDatetimeLocalValue(rule.ends_at),
      active: rule.active !== false,
      flow_graph: defaultGraph,
    });
    setIsMediaDropdownOpen(false);
    setIsFormOpen(true);
  }

  function handleSelectMediaItem(item: InstagramMediaItem | null) {
    if (!item) {
      setRuleForm((prev) => ({
        ...prev,
        media_id: "all",
        media_caption_preview: null,
        media_thumbnail_url: null,
        media_product_type: null,
        media_permalink: null,
      }));
    } else {
      setRuleForm((prev) => ({
        ...prev,
        media_id: item.id,
        media_caption_preview: item.caption_preview,
        media_thumbnail_url: item.preview_url,
        media_product_type: item.media_product_type,
        media_permalink: item.permalink || null,
      }));
    }
    setIsMediaDropdownOpen(false);
  }

  function handleSaveRule() {
    if (!ruleForm.is_permanent && ruleForm.starts_at && ruleForm.ends_at) {
      if (new Date(ruleForm.starts_at).getTime() >= new Date(ruleForm.ends_at).getTime()) {
        toast.error("A data/hora de fim deve ser posterior à data/hora de início.");
        return;
      }
    }

    const startsIso =
      !ruleForm.is_permanent && ruleForm.starts_at
        ? new Date(ruleForm.starts_at).toISOString()
        : null;
    const endsIso =
      !ruleForm.is_permanent && ruleForm.ends_at
        ? new Date(ruleForm.ends_at).toISOString()
        : null;

    const allMediaItems = state?.media_items || [];

    if (ruleForm.mode === "visual") {
      const summary = extractRuleSummaryFromGraph(ruleForm.flow_graph);
      const chosenMediaId =
        ruleForm.media_id && ruleForm.media_id !== "all"
          ? ruleForm.media_id
          : summary.media_id;
      const matchedMedia = chosenMediaId
        ? allMediaItems.find((m) => m.id === chosenMediaId)
        : null;

      const ruleToSave: InstagramKeywordRule = {
        id: editingRuleId || `rule_${Date.now()}`,
        name: ruleForm.name.trim() || "Fluxo Visual Instagram",
        mode: "visual",
        type: summary.type,
        keywords: summary.keywords,
        match: summary.match,
        public_reply: summary.public_reply,
        dm_message: summary.dm_message,
        active: ruleForm.active,
        media_id: chosenMediaId || null,
        media_caption_preview:
          matchedMedia?.caption_preview || ruleForm.media_caption_preview || null,
        media_thumbnail_url:
          matchedMedia?.preview_url || ruleForm.media_thumbnail_url || null,
        media_product_type:
          matchedMedia?.media_product_type || ruleForm.media_product_type || null,
        media_permalink: matchedMedia?.permalink || ruleForm.media_permalink || null,
        is_permanent: ruleForm.is_permanent,
        starts_at: startsIso,
        ends_at: endsIso,
        flow_graph: ruleForm.flow_graph,
      };

      const currentRules = state?.keyword_rules || [];
      const nextRules = editingRuleId
        ? currentRules.map((r) => (r.id === editingRuleId ? { ...ruleToSave, stats: r.stats } : r))
        : [...currentRules, ruleToSave];

      saveRulesMutation.mutate(nextRules);
      return;
    }

    const list = ruleForm.rawKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (ruleForm.type !== "story_mention" && list.length === 0) {
      toast.error("Informe pelo menos uma palavra-chave.");
      return;
    }

    const isSpecificMedia = ruleForm.media_id && ruleForm.media_id !== "all";

    const ruleToSave: InstagramKeywordRule = {
      id: editingRuleId || `rule_${Date.now()}`,
      name: ruleForm.name.trim() || null,
      mode: "basic",
      type: ruleForm.type,
      keywords: list,
      match: ruleForm.match,
      public_reply: ruleForm.type === "comment_keyword" ? ruleForm.public_reply || null : null,
      dm_message: ruleForm.dm_message.trim(),
      active: ruleForm.active,
      media_id: isSpecificMedia ? ruleForm.media_id : null,
      media_caption_preview: isSpecificMedia ? ruleForm.media_caption_preview : null,
      media_thumbnail_url: isSpecificMedia ? ruleForm.media_thumbnail_url : null,
      media_product_type: isSpecificMedia ? ruleForm.media_product_type : null,
      media_permalink: isSpecificMedia ? ruleForm.media_permalink : null,
      is_permanent: ruleForm.is_permanent,
      starts_at: startsIso,
      ends_at: endsIso,
      flow_graph: null,
    };

    const currentRules = state?.keyword_rules || [];
    const nextRules = editingRuleId
      ? currentRules.map((r) => (r.id === editingRuleId ? { ...ruleToSave, stats: r.stats } : r))
      : [...currentRules, ruleToSave];

    saveRulesMutation.mutate(nextRules);
  }

  function handleToggleRuleActive(ruleId: string) {
    const currentRules = state?.keyword_rules || [];
    const updated = currentRules.map((r) =>
      r.id === ruleId ? { ...r, active: !r.active } : r,
    );
    saveRulesMutation.mutate(updated);
  }

  function handleRemoveRule(ruleId: string) {
    const currentRules = state?.keyword_rules || [];
    const updated = currentRules.filter((r) => r.id !== ruleId);
    saveRulesMutation.mutate(updated);
  }

  function copyToClipboard(text: string, label: string) {
    void copyTextToClipboard(text);
    toast.success(`${label} copiado para a área de transferência!`);
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">{t("Carregando integração com Instagram...")}</p>
      </Card>
    );
  }

  const account = state?.account;
  const isConnected = state?.connected && !!account;
  const allMediaItems = state?.media_items || [];
  const allExecutions = state?.rule_executions || [];

  const filteredMediaItems = allMediaItems.filter((item) => {
    if (mediaFilterType === "ALL") return true;
    return item.media_product_type === mediaFilterType;
  });

  const selectedMediaObj =
    ruleForm.media_id && ruleForm.media_id !== "all"
      ? allMediaItems.find((m) => m.id === ruleForm.media_id) || {
          id: ruleForm.media_id,
          caption_preview: ruleForm.media_caption_preview || "Publicação selecionada",
          preview_url: ruleForm.media_thumbnail_url || null,
          media_product_type: ruleForm.media_product_type || "FEED",
          media_type: "IMAGE",
          timestamp: "",
        }
      : null;

  const activeMetricsRule = metricsRuleId
    ? state?.keyword_rules.find((r) => r.id === metricsRuleId) ?? null
    : null;

  return (
    <Card className="space-y-6 p-6 border-primary/20 bg-card/60 backdrop-blur-sm">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 text-white shadow-md">
            <svg
              className="h-6 w-6 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">{t("Instagram Direct (Meta Oficial)")}</h3>
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                Oficial Meta Graph API
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("Conexão nativa sem taxas por mensagem. Atenda DMs com IA e automatize respostas a comentários e stories.")}
            </p>
          </div>
        </div>

        {isConnected ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? t("Desconectando...") : t("Desconectar")}
          </Button>
        ) : (
          <Button
            className="bg-gradient-to-r from-purple-600 via-pink-600 to-yellow-500 text-white font-medium hover:opacity-90 shadow-md"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending ? t("Abrindo Meta...") : t("Conectar com Instagram")}
          </Button>
        )}
      </div>

      {/* Conta Conectada */}
      {isConnected && account && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center gap-3">
            {account.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.profile_picture_url}
                alt={account.username}
                className="h-12 w-12 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-base font-bold">
                {account.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">@{account.username}</span>
                <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600 text-xs">
                  {t("Conectado")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {account.name ? `${account.name} · ` : ""}ID: {account.accountId}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Vínculo com Agente de IA */}
      {isConnected && (
        <div className="space-y-3 rounded-xl border p-4 bg-muted/10">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">{t("Atendimento Automático com Agente de IA")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("Escolha qual Agente de IA irá atender e responder às conversas recebidas nas DMs do Instagram.")}
              </p>
            </div>
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

      {/* Automação de Palavras-Chave (Modo Básico e Modo Visual ManyChat / NexusReply) */}
      {isConnected && (
        <div className="space-y-4 rounded-xl border p-4 bg-muted/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">{t("Automações de Comentários, Stories e DMs")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("Crie regras no formato Básico ou no Construtor Visual (estilo ManyChat / NexusReply), escolha Posts/Reels/Stories específicos e acompanhe os indicadores de cada regra.")}
              </p>
            </div>
            {!isFormOpen && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openNewRuleForm("basic")}>
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  {t("+ Regra Básica")}
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                  onClick={() => openNewRuleForm("visual")}
                >
                  <Workflow className="mr-1.5 h-3.5 w-3.5" />
                  {t("+ Regra Visual (Fluxo)")}
                </Button>
              </div>
            )}
          </div>

          {/* Formulário de Criação / Edição de Regra (com alternância Básico vs Visual) */}
          {isFormOpen && (
            <div className="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <div>
                  <h5 className="text-sm font-semibold">
                    {editingRuleId ? t("Editar Regra de Automação") : t("Criar Nova Regra de Automação")}
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    {t("Escolha abaixo entre o formulário rápido (Modo Básico) ou o construtor de blocos com botões, condições e ações (Modo Visual).")}
                  </p>
                </div>

                {/* Seletor Modo Básico vs Modo Visual */}
                <div className="flex items-center rounded-lg border bg-muted/50 p-1">
                  <button
                    type="button"
                    onClick={() => setRuleForm((r) => ({ ...r, mode: "basic" }))}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      ruleForm.mode === "basic"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {t("Modo Básico")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuleForm((r) => ({ ...r, mode: "visual" }))}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      ruleForm.mode === "visual"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Workflow className="h-3.5 w-3.5" />
                    {t("Modo Visual (ManyChat / NexusReply)")}
                  </button>
                </div>
              </div>

              {/* Campos Comuns: Nome da Regra, Publicação Alvo e Vigência (Permanente vs Agendada) */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-name">{t("Nome de identificação da regra")}</Label>
                  <Input
                    id="rule-name"
                    value={ruleForm.name}
                    onChange={(e) => setRuleForm((r) => ({ ...r, name: e.target.value }))}
                    placeholder="Ex: Funil Mentoria IA - Reels de Novembro"
                  />
                </div>

                {/* Vigência da Regra: Permanente vs Data e Hora de Início e Fim */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">{t("Vigência da Regra")}</Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRuleForm((r) => ({ ...r, is_permanent: true }))}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                        ruleForm.is_permanent
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {t("Regra Permanente")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRuleForm((r) => ({ ...r, is_permanent: false }))}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                        !ruleForm.is_permanent
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {t("Definir Início e Fim")}
                    </button>
                  </div>
                </div>
              </div>

              {!ruleForm.is_permanent && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="rule-starts-at" className="text-xs">
                      {t("Data e Hora de Início")}
                    </Label>
                    <Input
                      id="rule-starts-at"
                      type="datetime-local"
                      value={ruleForm.starts_at}
                      onChange={(e) => setRuleForm((r) => ({ ...r, starts_at: e.target.value }))}
                      className="bg-background text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-ends-at" className="text-xs">
                      {t("Data e Hora de Fim")}
                    </Label>
                    <Input
                      id="rule-ends-at"
                      type="datetime-local"
                      value={ruleForm.ends_at}
                      onChange={(e) => setRuleForm((r) => ({ ...r, ends_at: e.target.value }))}
                      className="bg-background text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Seletor Visual de Post, Reels ou Story (com miniatura e primeiros 30 caracteres) */}
              {(ruleForm.mode === "visual" ||
                ruleForm.type === "comment_keyword" ||
                ruleForm.type === "story_mention") && (
                <div className="space-y-2">
                  <Label>{t("Publicação Alvo (Post, Reels ou Story)")}</Label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsMediaDropdownOpen((o) => !o)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
                    >
                      {selectedMediaObj ? (
                        <div className="flex items-center gap-3 min-w-0">
                          {selectedMediaObj.preview_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selectedMediaObj.preview_url}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-md border object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-bold">
                              IG
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {mediaTypeBadgeLabel(selectedMediaObj.media_product_type)}
                              </Badge>
                              <span className="font-medium truncate">
                                {selectedMediaObj.caption_preview}
                              </span>
                            </div>
                            {selectedMediaObj.timestamp && (
                              <span className="text-[11px] text-muted-foreground">
                                {t("Publicado em")} {formatMediaDate(selectedMediaObj.timestamp, tagIdioma)}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary text-xs font-bold">
                            ALL
                          </div>
                          <div>
                            <div className="font-medium">
                              {t("Qualquer publicação (Todos os Posts, Reels ou Stories)")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("A regra responderá em qualquer publicação presente ou futura.")}
                            </div>
                          </div>
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isMediaDropdownOpen ? t("▲ Fechar") : t("▼ Selecionar")}
                      </span>
                    </button>

                    {isMediaDropdownOpen && (
                      <div className="z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border bg-popover p-2 shadow-xl space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 px-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t("Ordenado do mais novo para o mais antigo")} ({filteredMediaItems.length})
                          </span>
                          <div className="flex items-center gap-1">
                            {(["ALL", "FEED", "REELS", "STORY"] as const).map((tabKey) => (
                              <button
                                key={tabKey}
                                type="button"
                                onClick={() => setMediaFilterType(tabKey)}
                                className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                                  mediaFilterType === tabKey
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                                }`}
                              >
                                {tabKey === "ALL"
                                  ? t("Todos")
                                  : tabKey === "FEED"
                                  ? t("Posts")
                                  : tabKey === "REELS"
                                  ? t("Reels")
                                  : t("Stories")}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectMediaItem(null)}
                          className={`flex w-full items-center gap-3 rounded-md p-2 text-left text-sm transition-colors hover:bg-muted ${
                            ruleForm.media_id === "all" || !ruleForm.media_id
                              ? "bg-primary/10 border border-primary/30"
                              : ""
                          }`}
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-primary/10 text-primary text-xs font-bold">
                            ALL
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold">
                              {t("Qualquer publicação (Posts, Reels ou Stories)")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("Aplica esta regra a todos os posts da conta")}
                            </div>
                          </div>
                        </button>

                        {filteredMediaItems.length === 0 ? (
                          <p className="p-3 text-center text-xs text-muted-foreground">
                            {t("Nenhuma publicação encontrada para este filtro.")}
                          </p>
                        ) : (
                          filteredMediaItems.map((item) => {
                            const isSelected = ruleForm.media_id === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => handleSelectMediaItem(item)}
                                className={`flex w-full items-center gap-3 rounded-md p-2 text-left text-sm transition-colors hover:bg-muted ${
                                  isSelected ? "bg-primary/10 border border-primary/30" : ""
                                }`}
                              >
                                {item.preview_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.preview_url}
                                    alt=""
                                    className="h-11 w-11 shrink-0 rounded-md border object-cover bg-muted"
                                  />
                                ) : (
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-muted text-[10px] font-bold">
                                    {mediaTypeBadgeLabel(item.media_product_type)}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                      {mediaTypeBadgeLabel(item.media_product_type)}
                                    </Badge>
                                    <span className="font-medium truncate">
                                      {item.caption_preview}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <span>{formatMediaDate(item.timestamp, tagIdioma)}</span>
                                    <span>· ID: {item.id.slice(-6)}</span>
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CONTEÚDO ESPECÍFICO: MODO VISUAL vs MODO BÁSICO */}
              {ruleForm.mode === "visual" ? (
                <InstagramVisualFlowBuilder
                  graph={ruleForm.flow_graph}
                  onChange={(nextGraph) =>
                    setRuleForm((prev) => ({ ...prev, flow_graph: nextGraph }))
                  }
                  mediaItems={allMediaItems}
                  availableAgents={state.available_agents}
                />
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rule-type">{t("Gatilho")}</Label>
                      <select
                        id="rule-type"
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={ruleForm.type}
                        onChange={(e) => {
                          const nextType = e.target.value as InstagramKeywordRule["type"];
                          setRuleForm((r) => ({ ...r, type: nextType }));
                          if (nextType === "story_mention") {
                            setMediaFilterType("STORY");
                          } else {
                            setMediaFilterType("ALL");
                          }
                        }}
                      >
                        <option value="comment_keyword">{t("Comentário em Post ou Reels")}</option>
                        <option value="story_mention">{t("Resposta ou Menção nos Stories")}</option>
                        <option value="dm_keyword">{t("Palavra-Chave na Mensagem Direta (DM)")}</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rule-match">{t("Tipo de Correspondência")}</Label>
                      <select
                        id="rule-match"
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={ruleForm.match}
                        onChange={(e) =>
                          setRuleForm((r) => ({
                            ...r,
                            match: e.target.value as "contains" | "exact",
                          }))
                        }
                      >
                        <option value="contains">{t("Contém a palavra (Recomendado)")}</option>
                        <option value="exact">{t("Mensagem exata")}</option>
                      </select>
                    </div>
                  </div>

                  {/* Palavras-chave */}
                  <div className="space-y-2">
                    <Label htmlFor="rule-keywords">
                      {ruleForm.type === "story_mention"
                        ? t("Palavras-chave no Story (deixe em branco para responder qualquer resposta/menção)")
                        : t("Palavras-chave (separadas por vírgula)")}
                    </Label>
                    <Input
                      id="rule-keywords"
                      value={ruleForm.rawKeywords}
                      onChange={(e) => setRuleForm((r) => ({ ...r, rawKeywords: e.target.value }))}
                      placeholder="quero, link, cupom, comprar, preco"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("Quando o usuário comentar ou enviar qualquer uma dessas palavras, a automação dispara.")}
                    </p>
                  </div>

                  {ruleForm.type === "comment_keyword" && (
                    <div className="space-y-2">
                      <Label htmlFor="rule-public-reply">
                        {t("Resposta Pública no Comentário (Opcional)")}
                      </Label>
                      <Input
                        id="rule-public-reply"
                        value={ruleForm.public_reply}
                        onChange={(e) =>
                          setRuleForm((r) => ({ ...r, public_reply: e.target.value }))
                        }
                        placeholder={t("Te enviei no direct! Dá uma olhada 🚀")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("A resposta que fica visível para todos abaixo do comentário do seguidor.")}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="rule-dm-message">{t("Mensagem enviada no Direct (DM)")}</Label>
                    <Textarea
                      id="rule-dm-message"
                      rows={3}
                      value={ruleForm.dm_message}
                      onChange={(e) => setRuleForm((r) => ({ ...r, dm_message: e.target.value }))}
                      placeholder={t("Olá {username}! Aqui está o link que você pediu: https://x.example.com/oferta")}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("Use {username} ou {{first_name}} para personalizar com o nome do seguidor.")}
                    </p>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingRuleId(null);
                    setIsMediaDropdownOpen(false);
                  }}
                >
                  {t("Cancelar")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveRule}
                  disabled={
                    saveRulesMutation.isPending ||
                    (ruleForm.mode === "basic" && !ruleForm.dm_message.trim())
                  }
                >
                  {saveRulesMutation.isPending
                    ? t("Salvando...")
                    : editingRuleId
                    ? t("Atualizar Regra")
                    : t("Salvar Regra")}
                </Button>
              </div>
            </div>
          )}

          {/* Lista de Regras Criadas com Botão de Indicadores */}
          {state.keyword_rules.length === 0 && !isFormOpen ? (
            <p className="text-xs text-muted-foreground italic">
              {t("Nenhuma regra de automação criada ainda. Clique em '+ Regra Básica' ou '+ Regra Visual (Fluxo)' para começar.")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {state.keyword_rules.map((rule) => {
                const matchedMedia =
                  rule.media_id && rule.media_id !== "all"
                    ? allMediaItems.find((m) => m.id === rule.media_id)
                    : null;
                const thumbUrl = matchedMedia?.preview_url || rule.media_thumbnail_url || null;
                const captionPreview =
                  matchedMedia?.caption_preview || rule.media_caption_preview || null;
                const prodType =
                  matchedMedia?.media_product_type || rule.media_product_type || "FEED";
                const sched = getRuleScheduleStatus(rule, tagIdioma);

                const ruleLogs = allExecutions.filter((e) => e.rule_id === rule.id);
                const totalTriggers = Math.max(
                  rule.stats?.total_triggers ?? 0,
                  ruleLogs.filter((l) => l.trigger_type !== "postback").length,
                );
                const totalReplies = Math.max(
                  (rule.stats?.public_replies_count ?? 0) + (rule.stats?.dms_sent_count ?? 0),
                  ruleLogs.filter((l) => Boolean(l.public_reply_sent || l.dm_sent)).length,
                );
                const totalFollowers = Math.max(
                  rule.stats?.followers_count ?? 0,
                  ruleLogs.filter((l) => l.is_follower === true && l.trigger_type !== "postback")
                    .length,
                );

                return (
                  <div
                    key={rule.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3.5 text-sm transition-opacity ${
                      rule.active ? "" : "opacity-60"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Miniatura do Post/Reels/Story ou Ícone Geral */}
                      {rule.media_id && rule.media_id !== "all" ? (
                        thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-md border object-cover bg-muted"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted text-[10px] font-bold">
                            {mediaTypeBadgeLabel(prodType)}
                          </div>
                        )
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/5 text-[10px] font-bold text-primary">
                          {t("TODOS")}
                        </div>
                      )}

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rule.name && (
                            <span className="font-semibold text-xs mr-1">{rule.name}</span>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              rule.mode === "visual"
                                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                                : ""
                            }`}
                          >
                            {rule.mode === "visual" ? t("⚡ Fluxo Visual") : t("Básica")}
                          </Badge>
                          <Badge variant="secondary" className="text-[11px] font-normal">
                            {rule.type === "comment_keyword"
                              ? t("Comentário")
                              : rule.type === "story_mention"
                              ? t("Story")
                              : t("DM")}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              sched.tone === "emerald"
                                ? "border-emerald-500/40 text-emerald-500"
                                : sched.tone === "amber"
                                ? "border-amber-500/40 text-amber-500"
                                : sched.tone === "red"
                                ? "border-destructive/40 text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {sched.label}
                          </Badge>
                          {rule.keywords.length > 0 && (
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded-md">
                              {rule.keywords.join(", ")}
                            </span>
                          )}
                        </div>

                        {/* Indicador do Post / Reels / Story específico ou Qualquer Publicação */}
                        <p className="text-xs text-muted-foreground truncate">
                          {rule.media_id && rule.media_id !== "all" ? (
                            <span>
                              <strong className="text-foreground">
                                [{mediaTypeBadgeLabel(prodType)}]
                              </strong>{" "}
                              {captionPreview || `ID ${rule.media_id}`}
                            </span>
                          ) : (
                            <span>{t("Aplicada em: Qualquer publicação")}</span>
                          )}
                        </p>

                        {rule.public_reply && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {t("💬 Comentário:")} {rule.public_reply}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          📩 DM: {rule.dm_message}
                        </p>

                        {/* Mini-resumo de indicadores direto no card */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="h-3 w-3 text-primary" />
                            <strong className="text-foreground">{totalTriggers}</strong> {t("acionamentos")}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Send className="h-3 w-3 text-indigo-500" />
                            <strong className="text-foreground">{totalReplies}</strong> {t("respostas")}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3 text-emerald-500" />
                            <strong className="text-foreground">{totalFollowers}</strong> {t("seguidores")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => setMetricsRuleId(rule.id)}
                      >
                        <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                        {t("Indicadores")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => handleToggleRuleActive(rule.id)}
                      >
                        {rule.active ? t("Pausar") : t("Ativar")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openEditRuleForm(rule)}
                      >
                        {t("Editar")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 h-8 px-2 text-xs"
                        onClick={() => handleRemoveRule(rule.id)}
                      >
                        {t("Excluir")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal de Indicadores e Histórico de Execuções da Regra */}
      {activeMetricsRule && (
        <InstagramRuleMetricsModal
          rule={activeMetricsRule}
          executions={allExecutions}
          onClose={() => setMetricsRuleId(null)}
          onClearLogs={(ruleId) => clearLogsMutation.mutate(ruleId)}
          isClearing={clearLogsMutation.isPending}
        />
      )}

      {/* Dados do Webhook da Meta */}
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
