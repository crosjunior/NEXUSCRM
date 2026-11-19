"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { useT } from "@/hooks/i18n/useT";
/**
 * UM MATERIAL DO ACERVO.
 *
 * Antes isto era um "slot": quatro cartões fixos, um por categoria, presos ao
 * agente padrão da organização. Dois dos quatro botões eram decorativos —
 * "Editar conteúdo" e "Upload novo arquivo" abriam um `toast.info("em breve")`
 * sobre uma API que já existia e nunca foi ligada à tela.
 *
 * Agora cada cartão é um material de verdade, com as ações que ele aceita: ver
 * o que o agente aprendeu, editar (quando o tipo do material guarda pergunta e
 * resposta), preparar de novo, e arquivar. O que o cartão NÃO oferece é o que
 * aquele tipo de material não aceita — controle que não controla nada gasta a
 * confiança de quem clicou.
 *
 * A ação nasce do TIPO, não do que ele aceita de entrada. `documento` aceita
 * texto colado (é `arquivo_ou_texto`) mas o conteúdo dele é texto corrido: não
 * existe pergunta/resposta para editar ali, e a pergunta certa é
 * `ePerguntaEResposta(tipo)`. Com `aceitaTextoColado` o cartão oferecia
 * "Editar conteúdo" para quem cadastrou um documento e abria o editor de FAQ
 * vazio — um controle que promete conteúdo que aquele material não tem.
 */
import Link from "next/link";
import { useState } from "react";
import {
  BookOpen,
  Eye,
  FileText,
  HelpCircle,
  MessageSquare,
  Package,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SourceStatusBadge, deriveBadgeStatus } from "@/components/ai/SourceStatusBadge";
import { TrechosDoMaterialDialog } from "@/components/ai/TrechosDoMaterialDialog";
import { EditarFaqDialog } from "@/components/ai/EditarFaqDialog";
import { DocumentoEditorDialog } from "@/components/ai/DocumentoEditorDialog";
import {
  TIPO_DE_FONTE_POR_ID,
  canonizarTipoDeFonte,
  ePerguntaEResposta,
} from "@/lib/ai/rag/tipos-de-fonte";
import type { SourceRow } from "@/hooks/ai/useKnowledgeSources";

const ICONE_POR_TIPO: Record<string, typeof HelpCircle> = {
  faq: HelpCircle,
  documento: FileText,
  conversas: MessageSquare,
  catalogo: Package,
};

interface Props {
  source: SourceRow;
  /** Nomes dos assistentes que consultam este material. */
  usadoPor: string[];
  /**
   * Endereço da LEITURA do material (`/app/ai/knowledge/sources/[id]`).
   *
   * Opcional de propósito: o cartão é usado em telas que não são o acervo, e
   * controle que não leva a lugar nenhum gasta a confiança de quem clicou.
   */
  href?: string;
  onReindex: () => void;
  onArquivar: () => void;
  onMudou: () => void;
  isReindexing?: boolean;
}

function formatRelative(
  iso: string | null,
  tagDoIdioma: string,
  t: (texto: string) => string = (texto) => texto,
): string {
  if (!iso) return t("nunca");
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return t("agora há pouco");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `há ${diffHr} h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `há ${diffDay} d`;
  return new Date(iso).toLocaleDateString(tagDoIdioma);
}

export function KnowledgeSourceCard({
  source,
  usadoPor,
  href,
  onReindex,
  onArquivar,
  onMudou,
  isReindexing,
}: Props) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [vendoTrechos, setVendoTrechos] = useState(false);
  const [editando, setEditando] = useState(false);
  const [editandoDocumento, setEditandoDocumento] = useState(false);

  const tipo = canonizarTipoDeFonte(source.source_type) ?? "faq";
  const meta = TIPO_DE_FONTE_POR_ID.get(tipo);
  const Icon = ICONE_POR_TIPO[tipo] ?? BookOpen;

  const derived = deriveBadgeStatus(source);
  const arquivado = derived === "archived";
  const estaAtivaEValida =
    source.is_active &&
    !arquivado &&
    (derived === "ready" || (source.status === "ready" && (source.chunks_count ?? 0) > 0));
  const mostraErro =
    (derived === "failed" || derived === "sem_credencial") && source.last_index_error;
  const temTrechos = (source.chunks_count ?? 0) > 0;

  return (
    <Card className="flex h-full flex-col" data-testid={`material-${source.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <CardTitle className="text-base truncate">
              {/* O nome é a porta mais óbvia para ler o material: quem olha a
                  grade clica no título antes de procurar um botão. */}
              {href ? (
                <Link
                  href={href}
                  className="hover:text-accent focus-visible:underline"
                  data-testid={`material-abrir-nome-${source.id}`}
                >
                  {source.name}
                </Link>
              ) : (
                source.name
              )}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {estaAtivaEValida ? (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-xs font-semibold shadow-sm shadow-emerald-500/10"
                title={t("Base de conhecimento ativa e funcionando")}
                data-testid={`material-status-ativo-${source.id}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <Power className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                <span>{t("Ativa")}</span>
              </div>
            ) : (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border/80 text-text-muted text-xs font-medium"
                title={t("Base desligada ou aguardando preparação")}
                data-testid={`material-status-desligado-${source.id}`}
              >
                <PowerOff className="h-3.5 w-3.5 text-text-muted/80" aria-hidden />
                <span>{t("Desligada")}</span>
              </div>
            )}
            <SourceStatusBadge source={source} />
          </div>
        </div>
        <p className="text-sm text-text-muted">
          {meta?.rotulo ? t(meta.rotulo) : source.source_type}
        </p>
      </CardHeader>

      <CardContent className="flex-1 space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-text-muted">{t("Preparado")}</span>
          <span>{formatRelative(source.last_indexed_at, tagDoIdioma, t)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-text-muted">{t("Trechos que o agente encontra")}</span>
          <span data-testid={`material-trechos-${source.id}`}>{source.chunks_count ?? 0}</span>
        </div>

        {/* Quem usa este material. Sem isto, arquivar é um tiro no escuro: não dá
            para saber quantos assistentes param de saber daquilo. */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-text-muted">{t("Consultado por")}</span>
          <span className="text-right">
            {usadoPor.length === 0 ? (
              <span className="text-warning-fg" data-testid={`material-orfao-${source.id}`}>
                {t("nenhum assistente ainda")}
              </span>
            ) : (
              usadoPor.join(", ")
            )}
          </span>
        </div>

        {mostraErro ? (
          <details className="rounded-md border border-error-bg bg-error-bg/30 p-2 text-xs text-error-fg">
            <summary className="cursor-pointer font-medium">{t("Por que não entrou")}</summary>
            <p className="mt-1 whitespace-pre-wrap break-words">{source.last_index_error}</p>
          </details>
        ) : null}
      </CardContent>

      <CardFooter className="pt-2.5 pb-3 border-t border-border/40 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-1.5 min-w-max">
          <Button
            variant="secondary"
            size="sm"
            disabled={arquivado || isReindexing}
            onClick={onReindex}
            data-testid={`material-reindexar-${source.id}`}
            className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isReindexing ? "animate-spin" : ""}`}
              aria-hidden
            />
            <span>{isReindexing ? t("Preparando…") : t("Preparar")}</span>
          </Button>

          {/* ABRIR O MATERIAL — ler o que está guardado nele. */}
          {href ? (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
            >
              <Link href={href} data-testid={`material-abrir-${source.id}`}>
                <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                <span>{t("Ler material")}</span>
              </Link>
            </Button>
          ) : null}

          {temTrechos ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setVendoTrechos(true)}
                data-testid={`material-ver-${source.id}`}
                className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
              >
                <Eye className="h-3.5 w-3.5 text-accent" aria-hidden />
                <span>{t("Ver o que aprendeu")}</span>
              </Button>
              {/* Montado só quando aberto: o diálogo faz `useQuery`, e mantê-lo
                  no ar fechado custa um observer por cartão numa tela que lista
                  dezenas deles. */}
              {vendoTrechos ? (
                <TrechosDoMaterialDialog
                  sourceId={source.id}
                  nome={source.name}
                  aberto
                  onFechar={() => setVendoTrechos(false)}
                />
              ) : null}
            </>
          ) : null}

          {/* A ação nasce do TIPO: só quem guarda pergunta/resposta tem o que
              editar no editor de FAQ. Um documento (texto corrido) não tem. */}
          {ePerguntaEResposta(tipo) && !arquivado ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditando(true)}
                data-testid={`material-editar-${source.id}`}
                className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                <span>{t("Editar")}</span>
              </Button>
              {editando ? (
                <EditarFaqDialog
                  sourceId={source.id}
                  nome={source.name}
                  aberto
                  onFechar={() => setEditando(false)}
                  onSalvo={onMudou}
                />
              ) : null}
            </>
          ) : null}

          {/* Edição de base de conhecimento / documentos e links */}
          {(tipo === "documento" || tipo === "link") && !arquivado ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditandoDocumento(true)}
                data-testid={`material-editar-documento-${source.id}`}
                className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                <span>{t("Editar")}</span>
              </Button>
              {editandoDocumento ? (
                <DocumentoEditorDialog
                  sourceId={source.id}
                  nomeInicial={source.name}
                  sourceMetadata={source.source_metadata as Record<string, unknown>}
                  aberto
                  onFechar={() => setEditandoDocumento(false)}
                  onSalvo={onMudou}
                />
              ) : null}
            </>
          ) : null}

          {!arquivado ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onArquivar}
              data-testid={`material-arquivar-${source.id}`}
              className="h-8 px-2.5 text-xs shrink-0 flex items-center gap-1.5 text-text-muted hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span>{t("Arquivar")}</span>
            </Button>
          ) : null}
        </div>
      </CardFooter>
    </Card>
  );
}
