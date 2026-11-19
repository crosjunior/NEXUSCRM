/**
 * DE ARQUIVO A TEXTO — a metade que faltava do caminho de documento.
 *
 * Suporta PDF, Markdown, Texto (.txt), CSV, DOCX (Word) e XLSX (Excel).
 *
 * Este módulo faz a extração. Quem chunka, embeda e grava é o indexador
 * (`workers/rag-indexer.ts`).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ArquivoBinarioError,
  extractMarkdownText,
} from "@/lib/ai/rag/extractors/markdown";
import { extractPdfText, PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { extractCsvText, CsvExtractError } from "@/lib/ai/rag/extractors/csv";
import { extractDocxText, DocxExtractError } from "@/lib/ai/rag/extractors/docx";
import { extractXlsxText, XlsxExtractError } from "@/lib/ai/rag/extractors/xlsx";
import { extractPptxText, PptxExtractError } from "@/lib/ai/rag/extractors/pptx";

/** Bucket privado onde os arquivos de conhecimento vivem (nome histórico). */
export const BUCKET_DE_CONHECIMENTO = "ai-policy";

/**
 * Extensões aceitas para documentos de conhecimento.
 */
export const EXTENSOES_ACEITAS = ["pdf", "md", "txt", "csv", "docx", "xlsx", "pptx"] as const;
export type ExtensaoAceita = (typeof EXTENSOES_ACEITAS)[number];

/**
 * Falha de extração com motivo LEGÍVEL.
 */
export class ErroDeExtracao extends Error {
  readonly code = "extracao_falhou";
  readonly detalhe?: string;
  readonly failedFile?: string;

  constructor(message: string, detalhe?: string, failedFile?: string) {
    super(message);
    this.name = "ErroDeExtracao";
    this.detalhe = detalhe;
    this.failedFile = failedFile;
  }
}

export function resolverExtensao(
  nomeOuCaminho: string,
  mimeType?: string,
): ExtensaoAceita | null {
  const ext = nomeOuCaminho.split(".").pop()?.toLowerCase() ?? "";
  if ((EXTENSOES_ACEITAS as readonly string[]).includes(ext)) return ext as ExtensaoAceita;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown") return "md";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/csv") return "csv";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return "docx";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    return "pptx";
  }
  return null;
}

/**
 * Extrai texto diretamente de um Buffer em memória.
 */
export async function extrairTextoDeBuffer(
  buffer: Buffer,
  extensao: ExtensaoAceita,
): Promise<string> {
  let texto: string;
  if (extensao === "pdf") {
    try {
      texto = await extractPdfText(buffer);
    } catch (err) {
      if (err instanceof PdfExtractError) {
        if (err.motivo !== "sem_texto") {
          console.error("[extracao-pdf] falha de infraestrutura, não de conteúdo:", err.message);
        }
        throw new ErroDeExtracao(
          "não consegui extrair texto deste PDF. Se ele for só imagens escaneadas, " +
            "não há letra nenhuma para ler — envie uma versão com texto selecionável.",
        );
      }
      throw new ErroDeExtracao(
        "Falha ao processar o envio do arquivo.",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (extensao === "csv") {
    try {
      texto = extractCsvText(buffer);
    } catch (err) {
      if (err instanceof CsvExtractError) {
        throw new ErroDeExtracao("Falha ao processar o envio do arquivo.", err.message);
      }
      throw new ErroDeExtracao(
        "Falha ao processar o envio do arquivo.",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (extensao === "docx") {
    try {
      texto = extractDocxText(buffer);
    } catch (err) {
      if (err instanceof DocxExtractError) {
        throw new ErroDeExtracao("Falha ao processar o arquivo Word (DOCX).", err.message);
      }
      throw new ErroDeExtracao(
        "Falha ao processar o arquivo Word (DOCX).",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (extensao === "xlsx") {
    try {
      texto = extractXlsxText(buffer);
    } catch (err) {
      if (err instanceof XlsxExtractError) {
        throw new ErroDeExtracao("Falha ao processar a planilha Excel (XLSX).", err.message);
      }
      throw new ErroDeExtracao(
        "Falha ao processar a planilha Excel (XLSX).",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else if (extensao === "pptx") {
    try {
      texto = extractPptxText(buffer);
    } catch (err) {
      if (err instanceof PptxExtractError) {
        throw new ErroDeExtracao("Falha ao processar apresentação PowerPoint (PPTX).", err.message);
      }
      throw new ErroDeExtracao(
        "Falha ao processar apresentação PowerPoint (PPTX).",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    try {
      texto = extractMarkdownText(buffer);
    } catch (err) {
      if (err instanceof ArquivoBinarioError) {
        throw new ErroDeExtracao(
          "não consegui ler este arquivo como texto: os bytes não formam Markdown nem texto puro. " +
            "Salve o material em UTF-8 (ou ANSI) e envie de novo — se o arquivo não for de texto, envie PDF.",
        );
      }
      throw err;
    }
  }

  if (texto.trim().length === 0) {
    throw new ErroDeExtracao("o arquivo não tem texto nenhum para indexar");
  }

  return texto;
}

/**
 * Baixa o arquivo do Storage e devolve o texto puro.
 */
export async function extrairTextoDoArquivo(
  blobPath: string,
  extensaoDeclarada?: string,
): Promise<{ texto: string; extensao: ExtensaoAceita }> {
  const extensao = resolverExtensao(extensaoDeclarada ?? blobPath);
  if (!extensao) {
    const extBruta = (extensaoDeclarada ?? blobPath.split(".").pop() ?? "?").toLowerCase();
    throw new ErroDeExtracao(
      "Não sei ler esse tipo de arquivo. Envie PDF, DOCX, XLSX, PPTX, Markdown (.md), CSV (.csv) ou texto (.txt).",
      extBruta || extensaoDeclarada || blobPath.split(".").pop() || "extensão desconhecida",
    );
  }

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(BUCKET_DE_CONHECIMENTO).download(blobPath);

  if (error || !blob) {
    throw new ErroDeExtracao(
      "O arquivo não está mais guardado. Envie de novo.",
      error?.message ?? "arquivo não encontrado no Storage",
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const texto = await extrairTextoDeBuffer(buffer, extensao);

  return { texto, extensao };
}
