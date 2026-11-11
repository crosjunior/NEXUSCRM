"use client";

import * as React from "react";
import { ExternalLink, Key, HelpCircle, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { obterGuiaDoProvedor, type GuiaProvedor } from "@/lib/ai/pontos/instrucoes-provedores";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  providerOrModel: string;
  defaultOpen?: boolean;
  className?: string;
}

export function GuiaCriacaoApiKey({ providerOrModel, defaultOpen = false, className = "" }: Props) {
  const t = useT();
  const [aberto, setAberto] = React.useState(defaultOpen);
  const guia: GuiaProvedor = obterGuiaDoProvedor(providerOrModel);

  return (
    <div className={`rounded-lg border border-border/70 bg-muted/30 p-3 text-xs ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Key className="size-3.5 text-primary" aria-hidden="true" />
          <span className="font-medium text-foreground">
            {t("Como criar a API KEY do")} {guia.titulo}:
          </span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
            {guia.rotuloSite}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={guia.site}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline underline-offset-4"
          >
            <span>{t("Acessar site")}</span>
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAberto(!aberto)}
            className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
            aria-label={aberto ? t("Recolher instruções") : t("Ver passo a passo completo")}
          >
            {aberto ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        </div>
      </div>

      {aberto && (
        <div className="mt-3 space-y-2.5 border-t border-border/50 pt-2.5 text-muted-foreground">
          <ol className="list-decimal space-y-1.5 pl-4 text-foreground/90">
            {guia.passos.map((passo, idx) => (
              <li key={idx} className="leading-relaxed">
                {passo}
              </li>
            ))}
          </ol>

          {guia.modelosDestaque && guia.modelosDestaque.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                <Sparkles className="size-3 text-amber-500" aria-hidden="true" />
                {t("Modelos suportados")}:
              </span>
              {guia.modelosDestaque.map((mod) => (
                <code
                  key={mod}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                >
                  {mod}
                </code>
              ))}
            </div>
          )}

          {guia.dica && (
            <p className="mt-1.5 rounded bg-background/60 p-2 text-[11px] italic text-muted-foreground border border-border/40">
              💡 {guia.dica}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

