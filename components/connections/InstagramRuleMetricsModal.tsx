"use client";

import { useState, useMemo } from "react";
import {
  BarChart3,
  MessageCircle,
  Send,
  Users,
  UserCheck,
  UserX,
  MousePointerClick,
  Search,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type {
  InstagramKeywordRule,
  InstagramRuleExecutionLog,
} from "@/lib/channels/instagram/types";

interface InstagramRuleMetricsModalProps {
  rule: InstagramKeywordRule;
  executions: InstagramRuleExecutionLog[];
  onClose: () => void;
  onClearLogs?: (ruleId: string) => void;
  isClearing?: boolean;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function InstagramRuleMetricsModal({
  rule,
  executions,
  onClose,
  onClearLogs,
  isClearing,
}: InstagramRuleMetricsModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [followerFilter, setFollowerFilter] = useState<"ALL" | "FOLLOWER" | "NON_FOLLOWER">(
    "ALL",
  );

  const ruleLogs = useMemo(
    () => executions.filter((e) => e.rule_id === rule.id),
    [executions, rule.id],
  );

  const filteredLogs = useMemo(() => {
    return ruleLogs.filter((log) => {
      if (followerFilter === "FOLLOWER" && log.is_follower !== true) return false;
      if (followerFilter === "NON_FOLLOWER" && log.is_follower !== false) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchUser = (log.username || "").toLowerCase().includes(q);
        const matchName = (log.full_name || "").toLowerCase().includes(q);
        const matchText = (log.comment_or_message_text || "").toLowerCase().includes(q);
        return matchUser || matchName || matchText;
      }
      return true;
    });
  }, [ruleLogs, followerFilter, searchQuery]);

  // Indicadores consolidados
  const stats = rule.stats;
  const totalTriggers = Math.max(
    stats?.total_triggers ?? 0,
    ruleLogs.filter((l) => l.trigger_type !== "postback").length,
  );
  const totalComments = Math.max(
    stats?.comments_count ?? 0,
    ruleLogs.filter((l) => l.trigger_type === "comment_keyword").length,
  );
  const totalPublicReplies = Math.max(
    stats?.public_replies_count ?? 0,
    ruleLogs.filter((l) => Boolean(l.public_reply_sent)).length,
  );
  const totalDmsSent = Math.max(
    stats?.dms_sent_count ?? 0,
    ruleLogs.filter((l) => Boolean(l.dm_sent)).length,
  );
  const followersCount = Math.max(
    stats?.followers_count ?? 0,
    ruleLogs.filter((l) => l.is_follower === true && l.trigger_type !== "postback").length,
  );
  const nonFollowersCount = Math.max(
    stats?.non_followers_count ?? 0,
    ruleLogs.filter((l) => l.is_follower === false && l.trigger_type !== "postback").length,
  );
  const buttonClicks = Math.max(
    stats?.button_clicks_count ?? 0,
    ruleLogs.filter((l) => l.trigger_type === "postback").length,
  );

  const uniqueUsersCount = new Set(ruleLogs.map((l) => l.ig_user_id || l.username)).size;
  const followerRate =
    followersCount + nonFollowersCount > 0
      ? Math.round((followersCount / (followersCount + nonFollowersCount)) * 100)
      : 0;
  const deliveryRate =
    totalTriggers > 0
      ? Math.min(100, Math.round((totalDmsSent / totalTriggers) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        {/* Cabeçalho do Modal */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">
                  Indicadores de Execução:{" "}
                  {rule.name || `Regra (${rule.keywords.join(", ") || "Instagram"})`}
                </h3>
                <Badge variant="outline" className="text-[11px]">
                  {rule.mode === "visual" ? "Fluxo Visual" : "Modo Básico"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Acompanhe quantas pessoas comentaram, respostas enviadas, quem é seguidor e a data/hora de cada interação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onClearLogs && ruleLogs.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isClearing}
                onClick={() => onClearLogs(rule.id)}
                className="h-8 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {isClearing ? "Limpando..." : "Zerar histórico"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Corpo Rolável */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Cards de KPIs Principais */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Acionamentos / Comentários</span>
                <MessageCircle className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-bold">{totalTriggers}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {totalComments} comentários · {uniqueUsersCount} usuários únicos
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Respostas Públicas</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold">{totalPublicReplies}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Respondidos abaixo do post
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>DMs Enviadas</span>
                <Send className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="mt-2 text-2xl font-bold">{totalDmsSent}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Taxa de entrega: {deliveryRate}%
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Seguidores</span>
                <UserCheck className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {followersCount}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {followerRate}% já seguiam o perfil
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Não Seguidores</span>
                <UserX className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {nonFollowersCount}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Visitantes novos no post
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Cliques em Botões</span>
                <MousePointerClick className="h-4 w-4 text-violet-500" />
              </div>
              <div className="mt-2 text-2xl font-bold">{buttonClicks}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Interações no fluxo DM
              </p>
            </div>
          </div>

          {/* Filtros e Busca da Tabela de Pessoas que Comentaram / Interagiram */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">
                  Histórico Detalhado de Pessoas ({filteredLogs.length})
                </h4>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-64">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar @usuario, nome ou comentário..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
                  {(
                    [
                      { key: "ALL", label: "Todos" },
                      { key: "FOLLOWER", label: "Seguidores" },
                      { key: "NON_FOLLOWER", label: "Não Seguidores" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFollowerFilter(f.key)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        followerFilter === f.key
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Tabela de Execuções */}
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
                <Clock className="mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">Nenhuma execução registrada para este filtro</p>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  Assim que alguém comentar a palavra-chave ou interagir com sua publicação no Instagram, o nome do usuário, data/hora, status de seguidor e respostas enviadas aparecerão aqui automaticamente.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3.5 py-2.5">Usuário</th>
                      <th className="px-3.5 py-2.5">Seguidor?</th>
                      <th className="px-3.5 py-2.5">Comentário / Ação</th>
                      <th className="px-3.5 py-2.5">Resposta Enviada</th>
                      <th className="px-3.5 py-2.5">Data e Hora</th>
                      <th className="px-3.5 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/20">
                        {/* Usuário */}
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2.5">
                            {log.profile_pic ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={log.profile_pic}
                                alt={log.username}
                                className="h-8 w-8 shrink-0 rounded-full border object-cover"
                              />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                                {(log.username || "IG").slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-1 font-semibold text-foreground">
                                <span>@{log.username.replace(/^@/, "")}</span>
                                {log.is_verified && (
                                  <span title="Verificado" className="text-sky-500">
                                    ✓
                                  </span>
                                )}
                              </div>
                              {log.full_name && (
                                <div className="text-[11px] text-muted-foreground">
                                  {log.full_name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Seguidor? */}
                        <td className="px-3.5 py-3">
                          {log.is_follower === true ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20 text-[11px]">
                              ✓ Seguidor
                            </Badge>
                          ) : log.is_follower === false ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/30 bg-amber-500/10 text-amber-600 text-[11px]"
                            >
                              Não segue
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[11px] text-muted-foreground">
                              Não informado
                            </Badge>
                          )}
                          {typeof log.follower_count === "number" && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {log.follower_count.toLocaleString("pt-BR")} seguidores
                            </div>
                          )}
                        </td>

                        {/* Comentário / Mensagem */}
                        <td className="max-w-xs px-3.5 py-3">
                          <div className="font-medium text-foreground">
                            {log.comment_or_message_text}
                          </div>
                          {log.media_caption_preview && (
                            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                              Post: {log.media_caption_preview}
                            </div>
                          )}
                        </td>

                        {/* Resposta Enviada (Comentário + DM) */}
                        <td className="max-w-xs px-3.5 py-3 space-y-1">
                          {log.public_reply_sent && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              <strong className="text-foreground">Comentário:</strong>{" "}
                              {log.public_reply_sent}
                            </div>
                          )}
                          {log.dm_sent && (
                            <div className="line-clamp-2 text-[11px] text-muted-foreground">
                              <strong className="text-foreground">DM:</strong> {log.dm_sent}
                            </div>
                          )}
                          {log.buttons_sent && log.buttons_sent.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {log.buttons_sent.map((b, idx) => (
                                <span
                                  key={idx}
                                  className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  🔘 {b}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Data e Hora */}
                        <td className="whitespace-nowrap px-3.5 py-3 text-muted-foreground">
                          {formatDateTime(log.executed_at)}
                        </td>

                        {/* Status */}
                        <td className="px-3.5 py-3">
                          {log.status === "error" ? (
                            <div className="flex items-center gap-1 text-destructive">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                              <span title={log.error_message || ""}>Falha</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                {log.status === "replied"
                                  ? "Comentário + DM"
                                  : "DM Enviada"}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between border-t bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
          <span>
            Última execução:{" "}
            <strong className="text-foreground">
              {formatDateTime(stats?.last_executed_at ?? ruleLogs[0]?.executed_at)}
            </strong>
          </span>
          <Button type="button" size="sm" onClick={onClose}>
            Fechar Indicadores
          </Button>
        </div>
      </div>
    </div>
  );
}
