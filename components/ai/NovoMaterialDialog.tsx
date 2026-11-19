"use client";

import { useT } from "@/hooks/i18n/useT";
/**
 * ADICIONAR MATERIAL AO ACERVO.
 *
 * Suporta:
 *  1. FAQ (Perguntas e respostas).
 *  2. Documento com múltiplos arquivos (até 30 arquivos, 500 MB total):
 *     PDF, Word (DOCX), Excel (XLSX), CSV, Markdown (.md), Texto (.txt),
 *     ou links online para Google Drive e OneDrive com teste de acesso imediato.
 *  3. Links Web / URL.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  TIPOS_DE_FONTE,
  TIPO_DE_FONTE_POR_ID,
  aceitaArquivo,
  ePerguntaEResposta,
  ePreenchidoPorRotina,
  type TipoDeFonteId,
} from "@/lib/ai/rag/tipos-de-fonte";
import type { ItemAcervo } from "@/components/ai/DocumentoEditorDialog";

const LIMITE_MAXIMO_ARQUIVOS = 30;
const LIMITE_MAXIMO_BYTES = 500 * 1024 * 1024; // 500 MB

const EXEMPLO_FAQ = `## Pergunta: Qual o prazo de entrega?
## Resposta: De 2 a 3 dias úteis após a confirmação do pagamento.

## Pergunta: Vocês fazem troca?
## Resposta: Sim, em até 30 dias, com o produto sem uso.`;

const EXEMPLO_DOCUMENTO = `# Política de troca

Aceitamos troca em até 30 dias da entrega, com o produto sem uso e na embalagem
original. O frete de devolução é por nossa conta quando o defeito for de fábrica.`;

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function renderItemIcon(item: ItemAcervo) {
  const ext = (item.ext || "").toLowerCase();
  if (item.source_type === "gdrive" || item.source_type === "onedrive") {
    return <Cloud className="h-4 w-4 text-sky-400 shrink-0" />;
  }
  if (ext === "xlsx" || ext === "csv") {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />;
  }
  if (ext === "docx") {
    return <FileText className="h-4 w-4 text-blue-400 shrink-0" />;
  }
  if (ext === "pdf") {
    return <FileText className="h-4 w-4 text-rose-400 shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-text-muted shrink-0" />;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriado: () => void;
  podeIndexar: boolean;
}

export function NovoMaterialDialog({ aberto, onFechar, onCriado, podeIndexar }: Props) {
  const t = useT();
  const [tipo, setTipo] = useState<TipoDeFonteId>("faq");
  const [nome, setNome] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [url, setUrl] = useState("");
  const [itensDocumento, setItensDocumento] = useState<ItemAcervo[]>([]);
  const [linksInput, setLinksInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const meta = TIPO_DE_FONTE_POR_ID.get(tipo);
  const porRotina = ePreenchidoPorRotina(tipo);

  const totalBytes = itensDocumento.reduce((acc, it) => acc + (it.size_bytes || 0), 0);
  const excedeuArquivos = itensDocumento.length > LIMITE_MAXIMO_ARQUIVOS;
  const excedeuTamanho = totalBytes > LIMITE_MAXIMO_BYTES;
  const temItensComErro = itensDocumento.some((it) => it.status === "error");
  const temItensValidando = itensDocumento.some((it) => it.status === "validating");

  function limpar(): void {
    setNome("");
    setConteudo("");
    setUrl("");
    setItensDocumento([]);
    setLinksInput("");
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  function handleSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const EXTENSOES_VALIDAS = ["pdf", "docx", "xlsx", "csv", "txt", "md"];
    const novos: ItemAcervo[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!EXTENSOES_VALIDAS.includes(ext)) {
        toast.error(
          t(`O arquivo "${file.name}" tem formato não suportado. Use PDF, DOCX, XLSX, CSV, TXT ou MD.`),
        );
        continue;
      }
      novos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        source_type: "upload",
        ext,
        size_bytes: file.size,
        status: "confirmed",
        file,
      });
    }

    setItensDocumento((prev) => [...prev, ...novos]);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  async function handleAddLinks() {
    const raw = linksInput.trim();
    if (!raw) return;

    const urls = raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) return;

    const novos: ItemAcervo[] = urls.map((u) => {
      const isOneDrive =
        u.toLowerCase().includes("1drv.ms") ||
        u.toLowerCase().includes("onedrive.live.com") ||
        u.toLowerCase().includes("sharepoint.com");
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: u,
        source_type: isOneDrive ? "onedrive" : "gdrive",
        ext: "txt",
        status: "validating",
        url: u,
      };
    });

    setItensDocumento((prev) => [...prev, ...novos]);
    setLinksInput("");

    for (const item of novos) {
      try {
        const res = await fetch("/api/v1/ai/knowledge/sources/validate-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.url }),
        });
        const json = (await res.json()) as {
          data?: {
            ok: boolean;
            name?: string;
            ext?: string;
            sizeBytes?: number;
            error?: string;
            directUrl?: string;
            provider?: "gdrive" | "onedrive" | "outro";
          };
          error?: { message?: string };
        };

        if (res.ok && json.data?.ok) {
          setItensDocumento((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    name: json.data?.name || it.name,
                    ext: json.data?.ext || "txt",
                    size_bytes: json.data?.sizeBytes,
                    direct_url: json.data?.directUrl,
                    provider: json.data?.provider,
                    status: "confirmed",
                  }
                : it,
            ),
          );
        } else {
          const errMsg =
            json.data?.error ||
            json.error?.message ||
            t("Arquivo não disponível para leitura. Libere o acesso de compartilhamento.");
          setItensDocumento((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: "error",
                    errorMessage: errMsg,
                  }
                : it,
            ),
          );
        }
      } catch {
        setItensDocumento((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: "error",
                  errorMessage: t("Falha ao testar acesso ao link."),
                }
              : it,
          ),
        );
      }
    }
  }

  function handleRemoveItem(id: string) {
    setItensDocumento((prev) => prev.filter((it) => it.id !== id));
  }

  async function criar(): Promise<void> {
    const nomeLimpo = nome.trim();
    const urlLimpa = url.trim();

    if (tipo === "link") {
      if (!urlLimpa.startsWith("http://") && !urlLimpa.startsWith("https://")) {
        toast.error(t("Informe uma URL válida iniciando com https:// ou http://"));
        return;
      }
    } else {
      if (nomeLimpo.length < 2) {
        toast.error(t("Dê um nome ao material — é assim que você o encontra depois."));
        return;
      }

      if (tipo === "documento") {
        if (itensDocumento.length === 0 && conteudo.trim().length === 0) {
          toast.error(t("Adicione arquivos, links online ou cole o conteúdo do documento."));
          return;
        }
        if (temItensComErro) {
          toast.error(t("Remova os arquivos ou links com erro antes de salvar."));
          return;
        }
        if (temItensValidando) {
          toast.error(t("Aguarde a validação dos links online."));
          return;
        }
        if (excedeuArquivos || excedeuTamanho) {
          toast.error(t("Respeite os limites de 30 arquivos e 500 MB."));
          return;
        }
      } else if (conteudo.trim().length === 0) {
        toast.error(t("Preencha o conteúdo do material."));
        return;
      }
    }

    setEnviando(true);
    try {
      if (tipo === "link") {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          source_type: "link",
          name: nomeLimpo.length >= 2 ? nomeLimpo : urlLimpa,
          url: urlLimpa,
        });
      } else if (tipo === "documento" && itensDocumento.length > 0) {
        const formData = new FormData();
        formData.append("name", nomeLimpo);

        const arquivosLocais = itensDocumento.filter((it) => it.source_type === "upload" && it.file);
        for (const item of arquivosLocais) {
          if (item.file) formData.append("files", item.file);
        }

        const linksConfirmados = itensDocumento
          .filter((it) => (it.source_type === "gdrive" || it.source_type === "onedrive") && it.url)
          .map((it) => ({
            url: it.url,
            name: it.name,
            ext: it.ext,
            sizeBytes: it.size_bytes,
            directUrl: it.direct_url,
            provider: it.source_type,
          }));
        formData.append("links", JSON.stringify(linksConfirmados));

        const res = await fetch("/api/v1/ai/knowledge/sources/upload", {
          method: "POST",
          body: formData,
        });
        const json = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) {
          toast.error(json.error?.message ? t(json.error.message) : t("Não consegui guardar os arquivos."));
          return;
        }
      } else {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          source_type: tipo,
          name: nomeLimpo,
          markdown_blob: conteudo,
        });
      }

      toast.success(
        podeIndexar
          ? t("Material cadastrado. Estou preparando — em instantes o agente já sabe.")
          : t("Material cadastrado. Ele fica esperando uma chave de embedding para ser preparado."),
      );
      limpar();
      onCriado();
      onFechar();
    } catch (err) {
      showApiError(err);
    } finally {
      setEnviando(false);
    }
  }

  const bloqueiaSalvar =
    enviando ||
    porRotina ||
    (tipo === "documento" &&
      ((itensDocumento.length === 0 && conteudo.trim().length === 0) ||
        temItensComErro ||
        temItensValidando ||
        excedeuArquivos ||
        excedeuTamanho));

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Ensinar algo novo ao agente")}</DialogTitle>
          <DialogDescription>
            {t("Ele consulta este material antes de responder sobre o seu negócio.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>{t("Que tipo de material é")}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="material-tipos">
              {TIPOS_DE_FONTE.map((tf) => {
                const rotina = ePreenchidoPorRotina(tf.id);
                const marcado = tipo === tf.id;
                return (
                  <button
                    key={tf.id}
                    type="button"
                    disabled={rotina || enviando}
                    onClick={() => setTipo(tf.id)}
                    data-testid={`material-tipo-${tf.id}`}
                    className={[
                      "rounded-lg border p-3 text-left text-sm transition",
                      marcado ? "border-accent bg-accent/10" : "border-border hover:bg-surface",
                      rotina ? "cursor-not-allowed opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className="font-medium">{t(tf.rotulo)}</span>
                    <span className="mt-1 block text-xs text-text-muted">{t(tf.oQueE)}</span>
                  </button>
                );
              })}
            </div>
            {porRotina && meta?.comoChega ? (
              <p className="text-xs text-text-muted">{t(meta.comoChega)}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="material-nome">
              {tipo === "link" ? t("Nome ou título (opcional)") : t("Nome do material")}
            </Label>
            <Input
              id="material-nome"
              data-testid="material-nome"
              placeholder={
                tipo === "faq"
                  ? t("Perguntas frequentes da loja")
                  : tipo === "link"
                    ? t("Manual online / Artigo")
                    : t("Política de troca e atendimento")
              }
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={enviando || porRotina}
            />
          </div>

          {tipo === "link" ? (
            <div className="space-y-2">
              <Label htmlFor="material-url">{t("Endereço da página (URL)")}</Label>
              <Input
                id="material-url"
                data-testid="material-url"
                placeholder="https://exemplo.com.br/artigo-ou-manual"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={enviando}
              />
              <p className="text-xs text-text-muted">
                {t(
                  "O sistema acessa o link com segurança, extrai os textos, títulos e parágrafos estruturados e adiciona ao acervo do assistente.",
                )}
              </p>
            </div>
          ) : null}

          {/* DOCUMENTO: Seção rica com múltiplos arquivos e links Google Drive / OneDrive */}
          {tipo === "documento" ? (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {/* Upload local */}
                <div className="rounded-lg border border-border p-3 space-y-2 bg-surface/40">
                  <div className="flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5 text-accent" />
                    <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("Arquivos locais")}
                    </Label>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    {t("PDF, DOCX, XLSX, CSV, Markdown (.md) e TXT.")}
                  </p>
                  <input
                    ref={inputArquivo}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                    className="hidden"
                    onChange={handleSelectFiles}
                    disabled={enviando}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs gap-1.5"
                    onClick={() => inputArquivo.current?.click()}
                    disabled={enviando}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("Selecionar arquivo(s)")}
                  </Button>
                </div>

                {/* Links Google Drive / OneDrive */}
                <div className="rounded-lg border border-border p-3 space-y-2 bg-surface/40">
                  <div className="flex items-center gap-1.5">
                    <Cloud className="h-3.5 w-3.5 text-sky-400" />
                    <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("Drive ou OneDrive")}
                    </Label>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    {t("Links separados por ponto e vírgula (;)")}
                  </p>
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="https://drive.google.com/... ; ..."
                      value={linksInput}
                      onChange={(e) => setLinksInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddLinks();
                        }
                      }}
                      disabled={enviando}
                      className="text-xs h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs shrink-0"
                      onClick={() => void handleAddLinks()}
                      disabled={enviando || linksInput.trim().length === 0}
                    >
                      {t("Adicionar")}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Contadores e aviso */}
              <div className="flex items-center justify-between text-xs px-1">
                <div className="flex items-center gap-2">
                  <span className={excedeuArquivos ? "font-bold text-rose-500" : "text-text-muted"}>
                    {itensDocumento.length} / {LIMITE_MAXIMO_ARQUIVOS} {t("arquivos")}
                  </span>
                  <span>•</span>
                  <span className={excedeuTamanho ? "font-bold text-rose-500" : "text-text-muted"}>
                    {formatBytes(totalBytes)} / 500 MB
                  </span>
                </div>
                {temItensComErro ? (
                  <span className="text-rose-500 text-[11px] flex items-center gap-1 font-medium">
                    <AlertCircle className="h-3 w-3" />
                    {t("Remova os itens com erro")}
                  </span>
                ) : null}
              </div>

              {/* Lista de itens adicionados */}
              {itensDocumento.length > 0 ? (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {itensDocumento.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs ${
                        item.status === "error"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                          : item.status === "validating"
                            ? "border-amber-500/40 bg-amber-500/10"
                            : "border-border bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {renderItemIcon(item)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{item.name}</p>
                          {item.status === "error" ? (
                            <p className="text-[10px] text-rose-400 mt-0.5 flex items-center gap-1">
                              <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                              {item.errorMessage || t("Não disponível para leitura. Libere o acesso.")}
                            </p>
                          ) : (
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {item.source_type === "upload"
                                ? `${item.ext.toUpperCase()} • ${formatBytes(item.size_bytes)}`
                                : `${item.source_type === "onedrive" ? "OneDrive" : "Google Drive"} • ${
                                    item.size_bytes ? formatBytes(item.size_bytes) : "Online"
                                  }`}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.status === "validating" ? (
                          <div className="flex items-center gap-1 text-amber-400 text-[10px]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{t("Testando...")}</span>
                          </div>
                        ) : item.status === "confirmed" ? (
                          <div className="flex items-center gap-1 text-emerald-400 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>{t("Pronto")}</span>
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-white transition"
                          title={t("Remover")}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Alternativa: colar texto direto caso não tenha arquivos */}
              {itensDocumento.length === 0 ? (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="material-conteudo">{t("…ou cole o texto aqui")}</Label>
                  <Textarea
                    id="material-conteudo"
                    data-testid="material-conteudo"
                    rows={6}
                    placeholder={EXEMPLO_DOCUMENTO}
                    value={conteudo}
                    onChange={(e) => setConteudo(e.target.value)}
                    disabled={enviando}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* FAQ: Campo de texto formatado */}
          {ePerguntaEResposta(tipo) ? (
            <div className="space-y-2">
              <Label htmlFor="material-conteudo">{t("Conteúdo das Perguntas e Respostas")}</Label>
              <Textarea
                id="material-conteudo"
                data-testid="material-conteudo"
                rows={10}
                placeholder={EXEMPLO_FAQ}
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                disabled={enviando}
              />
              <p className="text-xs text-text-muted">
                {t("Uma linha")} <code>## Pergunta:</code> {t("e uma")}{" "}
                <code>## Resposta:</code> {t("por item, separados por uma linha em branco.")}
              </p>
            </div>
          ) : null}

          {!podeIndexar ? (
            <p className="text-xs text-warning-fg" data-testid="material-aviso-sem-chave">
              {t(
                "Sem uma chave de embedding, o material fica guardado e esperando — o agente só passa a conhecê-lo depois que a chave for cadastrada.",
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            {t("Cancelar")}
          </Button>
          <Button onClick={criar} disabled={bloqueiaSalvar} data-testid="material-criar">
            {enviando ? t("Guardando…") : t("Adicionar ao acervo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
