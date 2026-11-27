"use client";

import * as React from "react";
import Link from "next/link";
import { useT } from "@/hooks/i18n/useT";
import {
  ChatCircle,
  Robot,
  Funnel,
  ChartLineUp,
  Plugs,
  CheckCircle,
  ArrowRight,
  Question,
  X,
  Sparkle,
} from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EtapaGuia {
  id: string;
  pilar: string;
  titulo: string;
  descricao: string;
  dica: string;
  link: string;
  rotuloBotao: string;
  icone: React.ElementType;
}

const ETAPAS: EtapaGuia[] = [
  {
    id: "connections",
    pilar: "1. Canais & Entrada",
    titulo: "Conectar WhatsApp & Instagram",
    descricao: "Conecte seus números de WhatsApp (via Evolution, WAHA ou API Oficial) e conta do Instagram para receber e enviar mensagens centralizadas.",
    dica: "Acesse Canais > Conexões e escaneie o QR Code para ativar o canal.",
    link: "/app/connections",
    rotuloBotao: "Conectar Canais",
    icone: Plugs,
  },
  {
    id: "ai",
    pilar: "2. Atendimento Inteligente",
    titulo: "Configurar Agentes de IA & Base de Conhecimento",
    descricao: "Instrua seu assistente virtual com a personalidade da empresa e faça upload de manuais, catálogos e links que ele deve consultar ao responder leads.",
    dica: "Em Agente de IA > Agentes, personalize o prompt com regras de atendimento do seu negócio.",
    link: "/app/ai",
    rotuloBotao: "Configurar IA",
    icone: Robot,
  },
  {
    id: "crm",
    pilar: "3. Gestão de Oportunidades",
    titulo: "Organizar Funil de Vendas & Leads",
    descricao: "Acompanhe seus leads desde o primeiro contato frio até a proposta comercial, dividindo o processo em etapas claras no Kanban.",
    dica: "No CRM > Funis, personalize as fases de venda para refletir o processo da sua empresa.",
    link: "/app/crm",
    rotuloBotao: "Acessar CRM",
    icone: Funnel,
  },
  {
    id: "inbox",
    pilar: "4. Operação Diária",
    titulo: "Centralizar Mensagens na Inbox",
    descricao: "Visualize conversas de todos os canais em um só lugar. Filtre por status do funil, mensagens não lidas e assuma o controle humano quando necessário.",
    dica: "Use os filtros 'Fila' e 'Minhas' para distribuir atendimentos entre a equipe com rapidez.",
    link: "/app/inbox",
    rotuloBotao: "Abrir Inbox",
    icone: ChatCircle,
  },
  {
    id: "metrics",
    pilar: "5. Resultados & Gestão",
    titulo: "Acompanhar Indicadores & Desempenho",
    descricao: "Monitore o volume de contatos, taxas de conversão de cada etapa do funil, tempo médio de resposta e motivos de perda.",
    dica: "Em Análise > Desempenho, veja gargalos e compare a performance dos atendentes.",
    link: "/app/metrics",
    rotuloBotao: "Ver Métricas",
    icone: ChartLineUp,
  },
];

export function BotaoGuiaRapido() {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [etapaAtiva, setEtapaAtiva] = React.useState(0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-theme-xs transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-white/3 dark:text-gray-300 dark:hover:bg-white/5"
          title={t("Guia de Primeiros Passos & Ajuda")}
        >
          <Question size={16} className="text-brand-500" />
          <span className="hidden sm:inline">{t("Ajuda & Guia")}</span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden border-border bg-surface">
        <DialogHeader className="border-b border-border p-6 bg-brand-50/50 dark:bg-brand-500/5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white shadow-theme-xs">
              <Sparkle size={18} weight="fill" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">
                {t("Guia Rápido da Plataforma")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("O caminho completo para configurar e operar sua plataforma de ponta a ponta")}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Navegação entre etapas */}
          <div className="grid grid-cols-5 gap-2">
            {ETAPAS.map((etapa, idx) => {
              const Icon = etapa.icone;
              const isSelected = etapaAtiva === idx;
              return (
                <button
                  key={etapa.id}
                  type="button"
                  onClick={() => setEtapaAtiva(idx)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 text-center transition-all ${
                    isSelected
                      ? "bg-brand-50 text-brand-600 border border-brand-200 shadow-theme-xs dark:bg-brand-500/15 dark:border-brand-500/30 dark:text-brand-400 font-semibold"
                      : "text-muted-foreground hover:bg-gray-100 dark:hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <Icon size={20} weight={isSelected ? "bold" : "regular"} />
                  <span className="text-[10px] leading-tight line-clamp-1">{etapa.pilar.split(". ")[1]}</span>
                </button>
              );
            })}
          </div>

          {/* Conteúdo da etapa selecionada */}
          {ETAPAS[etapaAtiva] && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5 dark:border-gray-800 dark:bg-white/2 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                    {ETAPAS[etapaAtiva].pilar}
                  </span>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white mt-1">
                    {ETAPAS[etapaAtiva].titulo}
                  </h3>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-theme-xs text-brand-500 dark:bg-gray-800 dark:text-brand-400">
                  {React.createElement(ETAPAS[etapaAtiva].icone, { size: 22 })}
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                {ETAPAS[etapaAtiva].descricao}
              </p>

              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <CheckCircle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span><strong>Dica Prática:</strong> {ETAPAS[etapaAtiva].dica}</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  Passo {etapaAtiva + 1} de {ETAPAS.length}
                </div>
                <div className="flex gap-2">
                  {etapaAtiva > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEtapaAtiva((p) => p - 1)}
                    >
                      Anterior
                    </Button>
                  )}
                  {etapaAtiva < ETAPAS.length - 1 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEtapaAtiva((p) => p + 1)}
                    >
                      Próximo
                    </Button>
                  ) : null}
                  <Link href={ETAPAS[etapaAtiva].link} onClick={() => setOpen(false)}>
                    <Button size="sm" className="gap-1.5 bg-brand-500 text-white hover:bg-brand-600">
                      {ETAPAS[etapaAtiva].rotuloBotao}
                      <ArrowRight size={14} />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Banner de boas-vindas e orientação que pode ser embutido no topo de qualquer página.
 */
export function BannerDeAjudaDaPagina({
  titulo,
  descricao,
  acaoHref,
  acaoRotulo,
}: {
  titulo: string;
  descricao: string;
  acaoHref?: string;
  acaoRotulo?: string;
}) {
  const [visivel, setVisivel] = React.useState(true);

  if (!visivel) return null;

  return (
    <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50/70 via-white to-brand-50/30 p-4 shadow-theme-xs dark:border-brand-500/20 dark:from-brand-500/10 dark:via-white/2 dark:to-transparent">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-theme-xs">
          <Sparkle size={20} weight="fill" />
        </span>
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            {titulo}
          </h4>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {descricao}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {acaoHref && acaoRotulo && (
          <Link href={acaoHref}>
            <Button size="sm" className="h-8 gap-1.5 rounded-xl bg-brand-500 text-xs text-white hover:bg-brand-600">
              {acaoRotulo}
              <ArrowRight size={13} />
            </Button>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setVisivel(false)}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-200/50 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-300"
          title="Fechar dica"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
