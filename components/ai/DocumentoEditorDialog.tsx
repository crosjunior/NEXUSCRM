"use client";

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
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { showApiError } from "@/components/feedback/ApiErrorToast";

const LIMITE_MAXIMO_ARQUIVOS = 30;
const LIMITE_MAXIMO_BYTES = 500 * 1024 * 1024; // 500 MB

export type ItemStatus = "validating" | "confirmed" | "error";

export interface ItemAcervo {
  id: string;
  name: string;
  source_type: "upload" | "gdrive" | "onedrive";
  ext: string;
  size_bytes?: number;
  status: ItemStatus;
  errorMessage?: string;
  // Para novos uploads locais:
  file?: File;
  // Para uploads já persistidos (modo edição):
  blob_path?: string;
  mime_type?: string;
  // Para links online:
  url?: string;
  direct_url?: string;
  provider?: "gdrive" | "onedrive" | "outro";
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  sourceId?: string;
  nomeInicial?: string;
  sourceMetadata?: Record<string, unknown>;
}

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
    return <Cloud className="h-5 w-5 text-sky-400 shrink-0" />;
  }
  if (ext === "xlsx" || ext === "csv") {
    return <FileSpreadsheet className="h-5 w-5 text-emerald-400 shrink-0" />;
  }
  if (ext === "docx") {
    return <FileText className="h-5 w-5 text-blue-400 shrink-0" />;
  }
  if (ext === "pdf") {
    return <FileText className="h-5 w-5 text-rose-400 shrink-0" />;
  }
  return <FileText className="h-5 w-5 text-text-muted shrink-0" />;
}

export function DocumentoEditorDialog({
  aberto,
  onFechar,
  onSalvo,
  sourceId,
  nomeInicial = "",
  sourceMetadata = {},
}: Props) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nome, setNome] = useState(nomeInicial);
  const [linksInput, setLinksInput] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Inicializa lista de itens existentes caso esteja editando
  const [itens, setItens] = useState<ItemAcervo[]>(() => {
    const list: ItemAcervo[] = [];
    const filesMeta = sourceMetadata?.files as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(filesMeta) && filesMeta.length > 0) {
      for (const f of filesMeta) {
        list.push({
          id: String(f.id || Math.random().toString()),
          name: String(f.name || f.filename || "Arquivo"),
          source_type: (f.source_type as "upload" | "gdrive" | "onedrive") || (f.url ? "gdrive" : "upload"),
          ext: String(f.ext || "txt"),
          size_bytes: typeof f.size_bytes === "number" ? f.size_bytes : undefined,
          status: "confirmed",
          blob_path: f.blob_path ? String(f.blob_path) : undefined,
          mime_type: f.mime_type ? String(f.mime_type) : undefined,
          url: f.url ? String(f.url) : undefined,
          direct_url: f.direct_url ? String(f.direct_url) : undefined,
        });
      }
    } else if (sourceMetadata?.blob_path) {
      // Legado: arquivo único
      list.push({
        id: "legacy-file",
        name: String(sourceMetadata.filename || nomeInicial || "Arquivo"),
        source_type: "upload",
        ext: String(sourceMetadata.ext || "pdf"),
        size_bytes: typeof sourceMetadata.size_bytes === "number" ? sourceMetadata.size_bytes : undefined,
        status: "confirmed",
        blob_path: String(sourceMetadata.blob_path),
        mime_type: sourceMetadata.mime_type ? String(sourceMetadata.mime_type) : undefined,
      });
    }
    return list;
  });

  const totalBytes = itens.reduce((acc, it) => acc + (it.size_bytes || 0), 0);
  const excedeuArquivos = itens.length > LIMITE_MAXIMO_ARQUIVOS;
  const excedeuTamanho = totalBytes > LIMITE_MAXIMO_BYTES;
  const temItensComErro = itens.some((it) => it.status === "error");
  const temItensValidando = itens.some((it) => it.status === "validating");
  const nomeValido = nome.trim().length >= 2;
  const podeSalvar =
    nomeValido &&
    itens.length > 0 &&
    !excedeuArquivos &&
    !excedeuTamanho &&
    !temItensComErro &&
    !temItensValidando &&
    !salvando;

  // Upload de arquivos locais
  function handleSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const EXTENSOES_VALIDAS = ["pdf", "docx", "xlsx", "csv", "txt", "md"];
    const novosItens: ItemAcervo[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!EXTENSOES_VALIDAS.includes(ext)) {
        toast.error(
          t(`O arquivo "${file.name}" tem formato não suportado. Use PDF, DOCX, XLSX, CSV, TXT ou MD.`),
        );
        continue;
      }

      novosItens.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        source_type: "upload",
        ext,
        size_bytes: file.size,
        status: "confirmed",
        file,
      });
    }

    setItens((prev) => [...prev, ...novosItens]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Adição e teste imediato de links online (Google Drive / OneDrive)
  async function handleAddLinks() {
    const raw = linksInput.trim();
    if (!raw) return;

    // Divide links separados por ';'
    const urls = raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) return;

    const novosItens: ItemAcervo[] = urls.map((url) => {
      const isDrive = url.toLowerCase().includes("drive.google.com") || url.toLowerCase().includes("docs.google.com");
      const isOneDrive =
        url.toLowerCase().includes("1drv.ms") ||
        url.toLowerCase().includes("onedrive.live.com") ||
        url.toLowerCase().includes("sharepoint.com");
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: url,
        source_type: isOneDrive ? "onedrive" : isDrive ? "gdrive" : "gdrive",
        ext: "txt",
        status: "validating",
        url,
      };
    });

    setItens((prev) => [...prev, ...novosItens]);
    setLinksInput("");

    // Testa cada link individualmente na rota de validação
    for (const item of novosItens) {
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
          setItens((prev) =>
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
          setItens((prev) =>
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
        setItens((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: "error",
                  errorMessage: t("Falha ao testar acesso ao link. Verifique a conexão."),
                }
              : it,
          ),
        );
      }
    }
  }

  function handleRemoveItem(id: string) {
    setItens((prev) => prev.filter((it) => it.id !== id));
  }

  // Salvar a base de conhecimento
  async function handleSalvar() {
    if (!podeSalvar) return;

    setSalvando(true);
    try {
      const formData = new FormData();
      formData.append("name", nome.trim());
      if (sourceId) {
        formData.append("source_id", sourceId);
      }

      // Arquivos locais novos
      const novosArquivos = itens.filter((it) => it.source_type === "upload" && it.file);
      for (const item of novosArquivos) {
        if (item.file) {
          formData.append("files", item.file);
        }
      }

      // Arquivos locais já existentes persistidos
      const existentes = itens
        .filter((it) => it.source_type === "upload" && it.blob_path)
        .map((it) => ({
          id: it.id,
          name: it.name,
          source_type: "upload",
          blob_path: it.blob_path,
          ext: it.ext,
          size_bytes: it.size_bytes,
          mime_type: it.mime_type,
        }));
      formData.append("existing_files", JSON.stringify(existentes));

      // Links online confirmados
      const linksConfirmados = itens
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
        toast.error(json.error?.message ? t(json.error.message) : t("Não foi possível salvar a base."));
        return;
      }

      toast.success(
        sourceId
          ? t("Base de conhecimento atualizada com sucesso! O assistente está indexando os arquivos.")
          : t("Base de conhecimento criada com sucesso! O assistente está indexando os arquivos."),
      );

      onSalvo();
      onFechar();
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {sourceId ? t("Editar base de conhecimento") : t("Adicionar base de conhecimento")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Adicione até 30 arquivos ou links do Google Drive e OneDrive (limite de 500 MB). Todos os arquivos são lidos e indexados para consulta do assistente.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Nome da base */}
          <div className="space-y-1.5">
            <Label htmlFor="base-nome">{t("Nome da base de conhecimento")}</Label>
            <Input
              id="base-nome"
              placeholder={t("Ex: Manual de Produtos, Políticas e Atendimento")}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={salvando}
            />
          </div>

          {/* Seção de Entrada: Upload e Links */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* 1. Upload de arquivos */}
            <div className="rounded-lg border border-border p-3.5 space-y-2.5 bg-surface/50">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-accent" />
                <Label className="font-medium text-xs uppercase tracking-wider text-text-muted">
                  {t("Arquivos do computador")}
                </Label>
              </div>
              <p className="text-xs text-text-muted">
                {t("Permitidos: PDF, DOCX, XLSX, CSV, Markdown (.md) e TXT.")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                className="hidden"
                onChange={handleSelectFiles}
                disabled={salvando}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={salvando}
              >
                <Plus className="h-4 w-4" />
                {t("Selecionar arquivo(s)")}
              </Button>
            </div>

            {/* 2. Links Google Drive / OneDrive */}
            <div className="rounded-lg border border-border p-3.5 space-y-2.5 bg-surface/50">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-sky-400" />
                <Label className="font-medium text-xs uppercase tracking-wider text-text-muted">
                  {t("Google Drive ou OneDrive")}
                </Label>
              </div>
              <p className="text-xs text-text-muted">
                {t("Adicione um ou vários links separados por ponto e vírgula (;)")}
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="https://drive.google.com/... ; https://1drv.ms/..."
                  value={linksInput}
                  onChange={(e) => setLinksInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddLinks();
                    }
                  }}
                  disabled={salvando}
                  className="text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleAddLinks()}
                  disabled={salvando || linksInput.trim().length === 0}
                >
                  {t("Adicionar")}
                </Button>
              </div>
            </div>
          </div>

          {/* Barra de Contadores e Limites */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-3">
              <span className={excedeuArquivos ? "font-bold text-rose-500" : "text-text-muted"}>
                {itens.length} / {LIMITE_MAXIMO_ARQUIVOS} {t("arquivos")}
              </span>
              <span>•</span>
              <span className={excedeuTamanho ? "font-bold text-rose-500" : "text-text-muted"}>
                {formatBytes(totalBytes)} / 500 MB
              </span>
            </div>
            {temItensComErro ? (
              <span className="text-rose-500 flex items-center gap-1 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                {t("Remova os itens com erro para liberar o salvamento")}
              </span>
            ) : null}
          </div>

          {/* Lista de Arquivos e Links */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-text-muted">
              {t("Arquivos e Links na Base")} ({itens.length})
            </Label>

            {itens.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-text-muted text-xs">
                {t("Nenhum arquivo ou link adicionado ainda. Escolha arquivos acima ou adicione links online.")}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {itens.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border text-xs transition ${
                      item.status === "error"
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                        : item.status === "validating"
                          ? "border-amber-500/40 bg-amber-500/10"
                          : "border-border bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {renderItemIcon(item)}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.name}</p>
                        {item.status === "error" ? (
                          <p className="text-[11px] text-rose-400 mt-0.5 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {item.errorMessage ||
                              t("Arquivo não disponível para leitura. Libere o acesso de compartilhamento.")}
                          </p>
                        ) : (
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {item.source_type === "upload"
                              ? `${item.ext.toUpperCase()} • ${formatBytes(item.size_bytes)}`
                              : `${item.source_type === "onedrive" ? "OneDrive" : "Google Drive"} • ${
                                  item.size_bytes ? formatBytes(item.size_bytes) : "Online"
                                }`}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === "validating" ? (
                        <div className="flex items-center gap-1 text-amber-400 text-[11px]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{t("Testando...")}</span>
                        </div>
                      ) : item.status === "confirmed" ? (
                        <div className="flex items-center gap-1 text-emerald-400 text-[11px]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{t("Confirmado")}</span>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-white transition"
                        title={t("Remover")}
                        aria-label={t("Remover")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            {t("Cancelar")}
          </Button>
          <Button onClick={handleSalvar} disabled={!podeSalvar} data-testid="salvar-base-conhecimento">
            {salvando ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("Salvando e indexando...")}
              </span>
            ) : sourceId ? (
              t("Salvar alterações")
            ) : (
              t("Salvar e indexar base")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
