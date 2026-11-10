"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Play,
  Pause,
  Trash2,
  Pencil,
  BarChart3,
  Calendar,
  Layers,
  Sparkles,
  CheckCircle2,
  MessageSquare,
  HelpCircle,
  Clock,
  ArrowRight,
  Filter,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";
import { InstagramLogo } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import { InstagramVisualFlowBuilder } from "@/components/connections/InstagramVisualFlowBuilder";
import { InstagramRuleMetricsModal } from "@/components/connections/InstagramRuleMetricsModal";
import {
  buildManyChatDefaultGraph,
  extractRuleSummaryFromGraph,
} from "@/lib/channels/instagram/flow-engine";
import type {
  InstagramKeywordRule,
  InstagramMediaItem,
  InstagramRuleExecutionLog,
} from "@/lib/channels/instagram/types";

/** Forma da resposta de `GET /api/v1/channels/instagram` consumida aqui. */
interface InstagramChannelState {
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
  available_agents: Array<{ id: string; name: string; role: string; status: string }>;
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

function toDatetimeLocalValue(isoString?: string | null): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function InstagramFlowsManager() {
  const t = useT();
  const qc = useQueryClient();

  // Estados locais de criação/edição de regras
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedMetricsRule, setSelectedMetricsRule] = useState<InstagramKeywordRule | null>(null);
  const [isMediaDropdownOpen, setIsMediaDropdownOpen] = useState(false);
  const [mediaFilterType, setMediaFilterType] = useState<"ALL" | "IMAGE" | "VIDEO" | "STORY">("ALL");
  const [filterQuery, setFilterQuery] = useState("");

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
    flow_graph: any;
  }>({
    name: "",
    mode: "visual",
    type: "comment_keyword",
    match: "contains",
    rawKeywords: "quero, link",
    public_reply: "Te enviei no direct! Dá uma olhada 🚀",
    dm_message: "Olá! Aqui está o link que você pediu: https://seusite.com.br",
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

  // Carrega estado e regras do canal Instagram
  const { data: state, isLoading, refetch } = useQuery<InstagramChannelState>({
    queryKey: ["instagram-channel-state"],
    queryFn: async () => {
      const res = await fetch("/api/v1/channels/instagram");
      if (!res.ok) throw new Error("Falha ao carregar estado do canal");
      const json = await res.json();
      return json.data;
    },
    staleTime: 10_000,
  });

  // Salva as regras no backend
  const saveRulesMutation = useMutation({
    mutationFn: async (keyword_rules: InstagramKeywordRule[]) => {
      const res = await fetch("/api/v1/channels/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_keywords", rules: keyword_rules }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.message || "Falha ao salvar regras");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("Regras e fluxos salvos com sucesso!"));
      qc.invalidateQueries({ queryKey: ["instagram-channel-state"] });
      setIsFormOpen(false);
      setEditingRuleId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || t("Erro ao salvar regras"));
    },
  });

  // Limpa histórico de execuções
  const clearLogsMutation = useMutation({
    mutationFn: async (ruleId?: string) => {
      const res = await fetch("/api/v1/channels/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_rule_logs", rule_id: ruleId }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.message || "Falha ao limpar histórico");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("Histórico de execuções limpo!"));
      qc.invalidateQueries({ queryKey: ["instagram-channel-state"] });
      setSelectedMetricsRule(null);
    },
  });

  const allMediaItems = state?.media_items || [];
  const rules = state?.keyword_rules || [];
  const executions = state?.rule_executions || [];

  // Estatísticas agregadas
  const totalRules = rules.length;
  const activeRules = rules.filter((r) => r.active).length;
  const totalTriggers = executions.length;
  const totalDmSent = executions.filter((e) => e.status === "success" || e.status === "dm_only").length;

  function openNewRuleForm(initialMode: "basic" | "visual" = "visual") {
    setEditingRuleId(null);
    setRuleForm({
      name: "",
      mode: initialMode,
      type: "comment_keyword",
      match: "contains",
      rawKeywords: "quero, link",
      public_reply: "Te enviei no direct! Dá uma olhada 🚀",
      dm_message: "Olá! Aqui está o link que você pediu: https://seusite.com.br",
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
      // Se selecionou Story, atualiza o tipo adequadamente
      const isStory = item.media_product_type === "STORY" || item.media_type === "STORY";
      setRuleForm((prev) => ({
        ...prev,
        media_id: item.id,
        media_caption_preview: item.caption_preview,
        media_thumbnail_url: item.preview_url,
        media_product_type: item.media_product_type,
        media_permalink: item.permalink || null,
        ...(isStory ? { type: "story_mention" } : {}),
      }));
    }
    setIsMediaDropdownOpen(false);
  }

  function handleSaveRule() {
    if (!ruleForm.is_permanent && ruleForm.starts_at && ruleForm.ends_at) {
      if (new Date(ruleForm.starts_at).getTime() >= new Date(ruleForm.ends_at).getTime()) {
        toast.error(t("A data/hora de fim deve ser posterior à data/hora de início."));
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
        name: ruleForm.name.trim() || t("Fluxo Visual de Atendimento"),
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
      toast.error(t("Informe pelo menos uma palavra-chave."));
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

  const selectedMediaObj =
    ruleForm.media_id && ruleForm.media_id !== "all"
      ? allMediaItems.find((m) => m.id === ruleForm.media_id)
      : null;

  const filteredMediaItems = allMediaItems.filter((m) => {
    if (mediaFilterType === "ALL") return true;
    if (mediaFilterType === "STORY") return m.media_product_type === "STORY";
    if (mediaFilterType === "VIDEO") return m.media_type === "VIDEO" || m.media_product_type === "REELS";
    if (mediaFilterType === "IMAGE") return m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM";
    return true;
  });

  const displayedRules = rules.filter((r) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    const nameMatch = (r.name || "").toLowerCase().includes(q);
    const kwMatch = (r.keywords || []).some((k) => k.toLowerCase().includes(q));
    const dmMatch = (r.dm_message || "").toLowerCase().includes(q);
    return nameMatch || kwMatch || dmMatch;
  });

  return (
    <div className="space-y-6">
      {/* Cards de Métricas e Desempenho dos Fluxos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("Regras e Fluxos")}</span>
            <Workflow className="h-4 w-4 text-violet-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalRules}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {activeRules} {t("ativas no momento")}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("Acionamentos Totais")}</span>
            <BarChart3 className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalTriggers}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("Comentários e respostas de stories")}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("DMs Enviadas")}</span>
            <MessageSquare className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalDmSent}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("Entregas de links e materiais")}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{t("Canal Conectado")}</span>
            <InstagramLogo className="h-4 w-4 text-pink-500" />
          </div>
          <div className="mt-2 text-sm font-semibold truncate">
            {state?.account?.username ? `@${state.account.username}` : t("Instagram Direct")}
          </div>
          <div className="mt-1 text-xs text-emerald-600 font-medium">
            {state?.connected ? t("✓ Webhook e API ativos") : t("Pendente de conexão")}
          </div>
        </div>
      </div>

      {/* Barra de Ações: Criar Nova Regra */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{t("Automações de Comentários, Stories e DMs")}</h2>
          <Badge variant="outline" className="text-xs font-normal">
            {rules.length} {rules.length === 1 ? t("regra") : t("regras")}
          </Badge>
        </div>

        {!isFormOpen && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => openNewRuleForm("basic")}>
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              {t("+ Regra Básica")}
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 text-white hover:bg-indigo-700 gap-1.5"
              onClick={() => openNewRuleForm("visual")}
            >
              <Workflow className="h-4 w-4" />
              {t("+ Novo Fluxo Visual")}
            </Button>
          </div>
        )}
      </div>

      {/* FORMULÁRIO DE CRIAÇÃO / EDIÇÃO DE REGRA */}
      {isFormOpen && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="text-base font-semibold">
                {editingRuleId ? t("Editar Regra de Automação") : t("Criar Nova Regra de Automação")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {ruleForm.mode === "visual"
                  ? t("Construtor Visual de Fluxo no estilo ManyChat / NexusReply com nós interativos.")
                  : t("Regra direta para responder comentários e enviar mensagem privada.")}
              </p>
            </div>

            {/* Alternador de Modo: Básico vs Visual */}
            <div className="flex items-center rounded-lg border border-border bg-muted/40 p-1 text-xs">
              <button
                type="button"
                onClick={() => setRuleForm((r) => ({ ...r, mode: "basic" }))}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  ruleForm.mode === "basic"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("Modo Básico")}
              </button>
              <button
                type="button"
                onClick={() => setRuleForm((r) => ({ ...r, mode: "visual" }))}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  ruleForm.mode === "visual"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Workflow className="h-3.5 w-3.5" />
                {t("Modo Visual (Fluxo)")}
              </button>
            </div>
          </div>

          {/* Nome da Regra e Vigência */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">{t("Nome da Regra / Identificação")}</Label>
              <Input
                id="rule-name"
                placeholder={t("Ex: Automação Quero (Reels Lançamento)")}
                value={ruleForm.name}
                onChange={(e) => setRuleForm((r) => ({ ...r, name: e.target.value }))}
                className="bg-background text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Vigência da Regra")}</Label>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="is_permanent"
                    checked={ruleForm.is_permanent}
                    onChange={() => setRuleForm((r) => ({ ...r, is_permanent: true }))}
                  />
                  {t("Regra permanente")}
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="is_permanent"
                    checked={!ruleForm.is_permanent}
                    onChange={() => setRuleForm((r) => ({ ...r, is_permanent: false }))}
                  />
                  {t("Agendar data e hora")}
                </label>
              </div>
            </div>
          </div>

          {/* Campos de Início e Fim quando agendado */}
          {!ruleForm.is_permanent && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("Data e hora de Início")}</Label>
                <Input
                  type="datetime-local"
                  value={ruleForm.starts_at}
                  onChange={(e) => setRuleForm((r) => ({ ...r, starts_at: e.target.value }))}
                  className="bg-background text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("Data e hora de Fim (Expiração)")}</Label>
                <Input
                  type="datetime-local"
                  value={ruleForm.ends_at}
                  onChange={(e) => setRuleForm((r) => ({ ...r, ends_at: e.target.value }))}
                  className="bg-background text-xs"
                />
              </div>
            </div>
          )}

          {/* Seletor Visual de Post, Reels ou Story */}
          <div className="space-y-2">
            <Label>{t("Publicação Alvo (Post, Reels ou Story)")}</Label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsMediaDropdownOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
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
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {selectedMediaObj.media_product_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatMediaDate(selectedMediaObj.timestamp, "pt-BR")}
                        </span>
                      </div>
                      <p className="truncate text-xs text-foreground font-medium mt-0.5">
                        {selectedMediaObj.caption_preview || t("Publicação selecionada")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Layers className="h-4 w-4" />
                    <span>{t("Qualquer publicação (Post, Reels ou Story)")}</span>
                  </div>
                )}
                <span className="text-xs text-muted-foreground">{t("Alterar ▾")}</span>
              </button>

              {/* Dropdown com a lista ordenada do mais novo para o mais antigo */}
              {isMediaDropdownOpen && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-xl animate-in fade-in">
                  <div className="flex items-center justify-between border-b pb-2 mb-2 px-1">
                    <div className="flex items-center gap-1 text-xs">
                      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                      {(["ALL", "STORY", "VIDEO", "IMAGE"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setMediaFilterType(filter)}
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            mediaFilterType === filter
                              ? "bg-primary text-primary-foreground font-medium"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {filter === "ALL"
                            ? t("Todos")
                            : filter === "STORY"
                            ? "Stories"
                            : filter === "VIDEO"
                            ? "Reels/Vídeos"
                            : "Posts"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Opção Qualquer Publicação */}
                  <div
                    onClick={() => handleSelectMediaItem(null)}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-xs transition-colors hover:bg-muted"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/50 text-muted-foreground">
                      *
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t("Qualquer publicação")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("A regra responderá a comentários em qualquer Post, Reels ou Stories.")}
                      </p>
                    </div>
                  </div>

                  {/* Lista de publicações */}
                  {filteredMediaItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectMediaItem(item)}
                      className={`flex cursor-pointer items-center gap-3 rounded-md p-2 text-xs transition-colors hover:bg-muted ${
                        ruleForm.media_id === item.id ? "bg-muted font-medium" : ""
                      }`}
                    >
                      {item.preview_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.preview_url}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted text-[10px] font-bold">
                          {item.media_product_type.slice(0, 3)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px] py-0 px-1">
                            {item.media_product_type}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {formatMediaDate(item.timestamp, "pt-BR")}
                          </span>
                        </div>
                        <p className="truncate text-xs text-foreground mt-0.5">
                          {item.caption_preview || `[${item.media_product_type}]`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CONTEÚDO ESPECÍFICO: MODO VISUAL vs MODO BÁSICO */}
          {ruleForm.mode === "visual" ? (
            <InstagramVisualFlowBuilder
              graph={ruleForm.flow_graph}
              onChange={(nextGraph) =>
                setRuleForm((prev) => ({ ...prev, flow_graph: nextGraph }))
              }
              mediaItems={allMediaItems}
              availableAgents={state?.available_agents}
            />
          ) : (
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
                  <option value="story_mention">{t("Menção ou Resposta nos Stories")}</option>
                  <option value="dm_keyword">{t("Mensagem no Direct (DM)")}</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-keywords">
                  {ruleForm.type === "story_mention"
                    ? t("Palavras-Chave nos Stories (Opcional)")
                    : t("Palavras-Chave (separadas por vírgula)")}
                </Label>
                <Input
                  id="rule-keywords"
                  placeholder={
                    ruleForm.type === "story_mention"
                      ? t("Deixe vazio para qualquer menção ou ex: quero, link")
                      : "quero, link, preco, me manda"
                  }
                  value={ruleForm.rawKeywords}
                  onChange={(e) => setRuleForm((r) => ({ ...r, rawKeywords: e.target.value }))}
                />
              </div>

              {ruleForm.type === "comment_keyword" && (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="rule-public">{t("Resposta Pública ao Comentário (opcional)")}</Label>
                  <Input
                    id="rule-public"
                    placeholder="Te enviei no direct! Dá uma olhada 🚀"
                    value={ruleForm.public_reply}
                    onChange={(e) => setRuleForm((r) => ({ ...r, public_reply: e.target.value }))}
                  />
                </div>
              )}

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="rule-dm">{t("Mensagem Enviada no Direct (DM)")}</Label>
                <Textarea
                  id="rule-dm"
                  rows={3}
                  placeholder="Olá! Aqui está o link que você pediu: https://seusite.com.br"
                  value={ruleForm.dm_message}
                  onChange={(e) => setRuleForm((r) => ({ ...r, dm_message: e.target.value }))}
                />
              </div>
            </div>
          )}

          {/* Rodapé de Ações do Formulário */}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsFormOpen(false);
                setEditingRuleId(null);
              }}
            >
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleSaveRule}
              disabled={saveRulesMutation.isPending}
            >
              {saveRulesMutation.isPending ? t("Salvando...") : t("Salvar Regra")}
            </Button>
          </div>
        </div>
      )}

      {/* LISTAGEM DAS REGRAS EXISTENTES */}
      {!isFormOpen && (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center bg-card">
              <Workflow className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <h3 className="text-sm font-semibold">{t("Nenhuma automação ou fluxo criado")}</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-md">
                {t("Crie sua primeira regra de palavra-chave ou fluxo visual ManyChat / NexusReply para responder automaticamente a comentários, menções nos stories e mensagens diretas.")}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openNewRuleForm("basic")}>
                  {t("+ Regra Básica")}
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                  onClick={() => openNewRuleForm("visual")}
                >
                  {t("+ Novo Fluxo Visual")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedRules.map((rule) => {
                const isStory =
                  rule.media_product_type === "STORY" ||
                  rule.media_caption_preview?.startsWith("[STORY]") ||
                  rule.type === "story_mention";

                return (
                  <div
                    key={rule.id}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border/80 shadow-sm"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Miniatura do Post/Reels/Story */}
                      {rule.media_thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={rule.media_thumbnail_url}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg border object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                          {isStory ? <Sparkles className="h-5 w-5" /> : <Workflow className="h-5 w-5" />}
                        </div>
                      )}

                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-foreground truncate">
                            {rule.name || (rule.keywords || []).join(", ") || t("Regra de Automação")}
                          </h4>
                          <Badge variant={rule.mode === "visual" ? "default" : "secondary"} className="text-[10px]">
                            {rule.mode === "visual" ? t("Visual (Fluxo)") : t("Básica")}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {isStory
                              ? t("Story")
                              : rule.type === "comment_keyword"
                              ? t("Comentário")
                              : t("Direct (DM)")}
                          </Badge>
                          {rule.is_permanent !== false ? (
                            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                              {t("Permanente")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                              {t("Agendada")}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {(rule.keywords || []).join(", ")}
                          </Badge>
                        </div>

                        {rule.media_caption_preview && (
                          <p className="text-xs text-muted-foreground truncate max-w-xl">
                            {rule.media_caption_preview}
                          </p>
                        )}

                        {rule.dm_message && (
                          <p className="text-xs text-muted-foreground truncate max-w-xl">
                            <span className="font-medium text-foreground">DM:</span> {rule.dm_message}
                          </p>
                        )}

                        {/* Estatísticas resumidas da regra */}
                        <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1">
                          <span>{rule.stats?.total_triggers || rule.stats?.comments_count || 0} {t("acionamentos")}</span>
                          <span>{rule.stats?.dms_sent_count || 0} {t("respostas")}</span>
                          <span>{rule.stats?.followers_count || 0} {t("seguidores")}</span>
                        </div>
                      </div>
                    </div>

                    {/* Ações da Regra */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={() => setSelectedMetricsRule(rule)}
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                        {t("Indicadores")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => handleToggleRuleActive(rule.id)}
                      >
                        {rule.active ? t("Pausar") : t("Ativar")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => openEditRuleForm(rule)}
                      >
                        {t("Editar")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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

      {/* Modal de Indicadores da Regra */}
      {selectedMetricsRule && (
        <InstagramRuleMetricsModal
          rule={selectedMetricsRule}
          executions={executions}
          onClose={() => setSelectedMetricsRule(null)}
          onClearLogs={(ruleId) => clearLogsMutation.mutate(ruleId)}
          isClearing={clearLogsMutation.isPending}
        />
      )}
    </div>
  );
}
