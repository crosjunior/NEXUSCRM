"use client";

import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Calendar, Video } from "lucide-react";

export function CartaoDaConexaoOutlook({
  configurado = true,
  contaConectada,
}: {
  configurado?: boolean;
  contaConectada?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [desconectando, setDesconectando] = React.useState(false);

  return (
    <div
      data-testid="cartao-conexao-outlook"
      className="rounded-lg border border-border bg-surface-elevated/50 p-4 transition-colors"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600 border border-blue-500/20">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Microsoft Outlook & Teams</h3>
              {contaConectada ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                  {t("Conectado")}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                  {t("Não conectado")}
                </span>
              )}
            </div>

            <p className="mt-1 text-xs text-text-muted">
              {contaConectada
                ? `${t("Sincronizando eventos e gerando links virtuais do Microsoft Teams para:")} ${contaConectada}`
                : t("Conecte seu calendário do Outlook para sincronizar agendamentos, convites e criar links automáticos de videoconferência do Microsoft Teams.")}
            </p>

            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-600 font-medium">
              <Video className="h-3.5 w-3.5" />
              <span>{t("Geração automática de reuniões no Microsoft Teams")}</span>
            </div>
          </div>
        </div>

        <div>
          {contaConectada ? (
            <Button
              variant="outline"
              size="sm"
              disabled={desconectando}
              className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={async () => {
                setDesconectando(true);
                try {
                  const res = await fetch("/api/v1/agenda/outlook/disconnect", { method: "POST" });
                  if (res.ok) router.refresh();
                } finally {
                  setDesconectando(false);
                }
              }}
            >
              {desconectando ? t("Desconectando...") : t("Desconectar Outlook")}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
              onClick={() => {
                window.location.href = "/api/v1/agenda/outlook/connect";
              }}
            >
              <Calendar className="h-3.5 w-3.5" />
              {t("Conectar Outlook & Teams")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
