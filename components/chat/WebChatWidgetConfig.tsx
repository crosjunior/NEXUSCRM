"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, MessageSquare, ExternalLink, Code } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  orgSlug: string;
  orgName: string;
  defaultPhone?: string;
}

export function WebChatWidgetConfig({ orgSlug, orgName, defaultPhone = "" }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [color, setColor] = useState("#2563eb");
  const [title, setTitle] = useState(orgName || "Atendimento Inteligente");
  const [welcome, setWelcome] = useState("Olá! Como posso ajudar você hoje?");
  const [whatsapp, setWhatsapp] = useState(defaultPhone);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const snippet = origin
    ? `<script defer src="${origin}/widget.js" data-org="${orgSlug}" data-color="${color}" data-title="${title}" data-welcome="${welcome}"${whatsapp ? ` data-whatsapp="${whatsapp.replace(/\D/g, "")}"` : ""}></script>`
    : "";

  async function handleCopy() {
    if (!snippet) return;
    const ok = await copyToClipboard(snippet);
    if (ok) {
      setCopied(true);
      toast.success(t("Código do widget copiado para a área de transferência!"));
      setTimeout(() => setCopied(false), 2500);
    } else {
      toast.error(t("Não foi possível copiar o código."));
    }
  }

  return (
    <Card className="border border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-accent" />
          <CardTitle>{t("Chat para Tirar Dúvidas no Site (Widget Web)")}</CardTitle>
        </div>
        <CardDescription>
          {t(
            "Disponibilize um atendente de IA no seu próprio site. O assistente responde dúvidas, apresenta produtos e serviços com base no seu acervo e transfere para o WhatsApp quando solicitado.",
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="widget-title">{t("Título da Janela de Chat")}</Label>
            <Input
              id="widget-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Atendimento Comercial"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="widget-color">{t("Cor Primária do Balão")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border p-1"
              />
              <Input
                id="widget-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#2563eb"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="widget-welcome">{t("Mensagem de Boas-Vindas")}</Label>
            <Input
              id="widget-welcome"
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              placeholder="Olá! Como posso ajudar você hoje?"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="widget-whatsapp">{t("Número de WhatsApp para Transição (Opcional)")}</Label>
            <Input
              id="widget-whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5511999999999"
            />
            <p className="text-xs text-text-muted">
              {t(
                "Se preenchido, o chat exibirá um botão convidando o cliente a continuar a conversa no WhatsApp.",
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 font-medium">
              <Code className="h-4 w-4" />
              {t("Código para colar no seu site")}
            </Label>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="h-8 gap-1.5"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("Copiado!") : t("Copiar Código")}
            </Button>
          </div>

          <div className="relative rounded-lg bg-surface-raised p-3.5 font-mono text-xs text-text border border-border overflow-x-auto">
            <code>{snippet || t("Carregando código...")}</code>
          </div>

          <p className="text-xs text-text-muted">
            {t(
              "Instruções: Copie a tag acima e cole no HTML das suas páginas (dentro de <head> ou logo antes de </body>). O balão de chat aparecerá automaticamente no canto da tela.",
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

