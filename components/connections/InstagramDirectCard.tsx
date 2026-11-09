"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import type { InstagramKeywordRule } from "@/lib/channels/instagram/types";

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
  available_agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
  webhook_url: string;
  webhook_verify_token: string;
}

export function InstagramDirectCard() {
  const t = useT();
  const queryClient = useQueryClient();

  const [isAddingRule, setIsAddingRule] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [newRule, setNewRule] = useState<Partial<InstagramKeywordRule>>({
    type: "comment_keyword",
    keywords: [],
    match: "contains",
    public_reply: "Te enviei no direct! Dá uma olhada 🚀",
    dm_message: "Olá! Aqui está o link que você pediu: ",
    active: true,
  });
  const [rawKeywords, setRawKeywords] = useState("quero, link, preco");

  const { data: state, isLoading } = useQuery<InstagramState>({
    queryKey: ["instagram-direct-state"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: InstagramState }>("/api/v1/channels/instagram");
      return res.data.data;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { auth_url: string } }>("/api/v1/channels/instagram", {
        action: "get_connect_url",
      });
      return res.data.data.auth_url;
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
      toast.success("Regras de automação salvas.");
      setIsAddingRule(false);
      void queryClient.invalidateQueries({ queryKey: ["instagram-direct-state"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao salvar regras.");
    },
  });

  function handleAddRule() {
    const list = rawKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const rule: InstagramKeywordRule = {
      id: `rule_${Date.now()}`,
      type: newRule.type || "comment_keyword",
      keywords: list,
      match: newRule.match || "contains",
      public_reply: newRule.public_reply || null,
      dm_message: newRule.dm_message || "",
      active: true,
    };

    const currentRules = state?.keyword_rules || [];
    saveRulesMutation.mutate([...currentRules, rule]);
  }

  function handleRemoveRule(ruleId: string) {
    const currentRules = state?.keyword_rules || [];
    const updated = currentRules.filter((r) => r.id !== ruleId);
    saveRulesMutation.mutate(updated);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
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

  return (
    <Card className="space-y-6 p-6 border-primary/20 bg-card/60 backdrop-blur-sm">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 text-white shadow-md">
            <svg
              className="h-6 w-6 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
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
                  {ag.name} ({ag.role}) {ag.status === "published" ? "✓ Publicado" : ""}
                </option>
              ))}
            </select>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => saveAgentMutation.mutate(selectedAgentId || null)}
              disabled={saveAgentMutation.isPending}
            >
              {saveAgentMutation.isPending ? t("Salvando...") : t("Vincular Agente")}
            </Button>
          </div>
        </div>
      )}

      {/* Automação de Palavras-Chave (ManyChat / NexusReply style) */}
      {isConnected && (
        <div className="space-y-4 rounded-xl border p-4 bg-muted/10">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">{t("Automações de Comentários, Stories e DMs")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("Envie links ou mensagens no Direct automaticamente quando alguém comentar no Post/Reel ou mencionar nos Stories.")}
              </p>
            </div>
            {!isAddingRule && (
              <Button size="sm" variant="outline" onClick={() => setIsAddingRule(true)}>
                {t("+ Nova Regra")}
              </Button>
            )}
          </div>

          {/* Formulário de Nova Regra */}
          {isAddingRule && (
            <div className="space-y-4 rounded-lg border bg-background p-4 shadow-sm">
              <h5 className="text-sm font-semibold">{t("Criar Nova Regra de Automação")}</h5>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-type">{t("Gatilho")}</Label>
                  <select
                    id="rule-type"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    value={newRule.type}
                    onChange={(e) =>
                      setNewRule((r) => ({ ...r, type: e.target.value as InstagramKeywordRule["type"] }))
                    }
                  >
                    <option value="comment_keyword">{t("Comentário em Post ou Reels")}</option>
                    <option value="story_mention">{t("Menção nos Stories")}</option>
                    <option value="dm_keyword">{t("Palavra-Chave na Mensagem Direta (DM)")}</option>
                  </select>
                </div>

                {newRule.type !== "story_mention" && (
                  <div className="space-y-2">
                    <Label htmlFor="rule-match">{t("Tipo de Correspondência")}</Label>
                    <select
                      id="rule-match"
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      value={newRule.match}
                      onChange={(e) =>
                        setNewRule((r) => ({ ...r, match: e.target.value as "contains" | "exact" }))
                      }
                    >
                      <option value="contains">{t("Contém a palavra (Recomendado)")}</option>
                      <option value="exact">{t("Mensagem exata")}</option>
                    </select>
                  </div>
                )}
              </div>

              {newRule.type !== "story_mention" && (
                <div className="space-y-2">
                  <Label htmlFor="rule-keywords">{t("Palavras-chave (separadas por vírgula)")}</Label>
                  <Input
                    id="rule-keywords"
                    value={rawKeywords}
                    onChange={(e) => setRawKeywords(e.target.value)}
                    placeholder="quero, link, cupom, comprar, preco"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("Quando o usuário digitar qualquer uma dessas palavras, a automação dispara.")}
                  </p>
                </div>
              )}

              {newRule.type === "comment_keyword" && (
                <div className="space-y-2">
                  <Label htmlFor="rule-public-reply">{t("Resposta Pública no Comentário (Opcional)")}</Label>
                  <Input
                    id="rule-public-reply"
                    value={newRule.public_reply || ""}
                    onChange={(e) => setNewRule((r) => ({ ...r, public_reply: e.target.value }))}
                    placeholder="Te enviei no direct! Dá uma olhada 🚀"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("A resposta que fica visível para todos no comentário da publicação.")}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="rule-dm-message">{t("Mensagem enviada no Direct (DM)")}</Label>
                <Textarea
                  id="rule-dm-message"
                  rows={3}
                  value={newRule.dm_message || ""}
                  onChange={(e) => setNewRule((r) => ({ ...r, dm_message: e.target.value }))}
                  placeholder="Olá {username}! Aqui está o link que você pediu: https://nexusia.work/oferta"
                />
                <p className="text-xs text-muted-foreground">
                  {t("Use {username} para inserir automaticamente o arroba do seguidor.")}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setIsAddingRule(false)}>
                  {t("Cancelar")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddRule}
                  disabled={saveRulesMutation.isPending || !newRule.dm_message?.trim()}
                >
                  {saveRulesMutation.isPending ? t("Salvando...") : t("Salvar Regra")}
                </Button>
              </div>
            </div>
          )}

          {/* Lista de Regras Ativas */}
          {state.keyword_rules.length === 0 && !isAddingRule ? (
            <p className="text-xs text-muted-foreground italic">
              {t("Nenhuma regra de automação criada ainda. Clique em '+ Nova Regra' para configurar envios automáticos por palavra-chave.")}
            </p>
          ) : (
            <div className="space-y-2">
              {state.keyword_rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs font-normal">
                        {rule.type === "comment_keyword"
                          ? t("Comentário")
                          : rule.type === "story_mention"
                          ? t("Story")
                          : t("DM")}
                      </Badge>
                      {rule.keywords.length > 0 && (
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {rule.keywords.join(", ")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      DM: {rule.dm_message}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 h-8 px-2"
                    onClick={() => handleRemoveRule(rule.id)}
                  >
                    {t("Excluir")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dados do Webhook da Meta */}
      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        <h4 className="text-sm font-semibold">{t("Configuração do Webhook no Meta for Developers")}</h4>
        <p className="text-xs text-muted-foreground">
          {t("Configure este endereço no painel do seu Aplicativo Meta (Webhooks → Instagram):")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-muted-foreground">{t("URL de Retorno de Chamada (Callback URL):")}</span>
            <div className="flex items-center gap-2">
              <Input readOnly value={state.webhook_url} className="font-mono text-xs h-8 bg-background" />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => copyToClipboard(state.webhook_url, "URL do Webhook")}
              >
                {t("Copiar")}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground">{t("Token de Verificação (Verify Token):")}</span>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={state.webhook_verify_token}
                className="font-mono text-xs h-8 bg-background"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => copyToClipboard(state.webhook_verify_token, "Token de Verificação")}
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
