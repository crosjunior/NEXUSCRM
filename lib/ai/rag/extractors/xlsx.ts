/**
 * XLSX text extractor for the RAG ingestion pipeline.
 *
 * Uses `fflate` to parse OpenXML spreadsheet archives (.xlsx) without external binary dependencies.
 * Formats sheets and rows into structured key-value blocks and tables optimized for RAG embeddings.
 */

import { strFromU8, unzipSync } from "fflate";

export class XlsxExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "XlsxExtractError";
  }
}

const XLSX_MAX_XML_BYTES = 50 * 1024 * 1024;
export const XLSX_MAX_LINHAS_TOTAL = 5000;

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificarXml(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (inteira, e: string) => {
    if (e[0] === "#") {
      const codigo = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[e.toLowerCase()] ?? inteira;
  });
}

function textoDosRuns(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodificarXml(m[1] ?? "");
  }
  return out;
}

function indiceDaColuna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function valorDaCelula(attrs: string, corpo: string, compartilhados: string[]): string {
  const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
  if (tipo === "inlineStr") return textoDosRuns(corpo);
  const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
  if (v === undefined) return "";
  if (tipo === "s") return compartilhados[Number(v)] ?? "";
  if (tipo === "b") return v === "1" ? "Sim" : "Não";
  if (tipo === "str" || tipo === "e" || tipo === "d") return decodificarXml(v);

  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

export function extractXlsxText(buffer: Buffer): string {
  if (buffer.byteLength === 0) {
    throw new XlsxExtractError("O arquivo XLSX está vazio.");
  }

  let arquivos: Record<string, Uint8Array>;
  let grandeDemais = false;
  try {
    arquivos = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        const util =
          f.name === "xl/workbook.xml" ||
          f.name === "xl/_rels/workbook.xml.rels" ||
          f.name === "xl/sharedStrings.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
        if (util && f.originalSize > XLSX_MAX_XML_BYTES) grandeDemais = true;
        return util && !grandeDemais;
      },
    });
  } catch (err) {
    throw new XlsxExtractError("Não consegui ler o arquivo XLSX. Certifique-se de que é uma planilha válida.", err);
  }

  if (grandeDemais) {
    throw new XlsxExtractError("Planilha grande demais para indexação direta.");
  }

  const texto = (nome: string) => {
    const a = arquivos[nome];
    return a ? strFromU8(a) : null;
  };

  const workbook = texto("xl/workbook.xml");
  if (!workbook) {
    throw new XlsxExtractError("Arquivo XLSX inválido (não contém xl/workbook.xml).");
  }

  // Tabela de textos compartilhados
  const compartilhados = [...(texto("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textoDosRuns(m[1] ?? ""),
  );

  // Mapeia sheets: nome e target
  const rels = texto("xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    relMap.set(m[1]!, m[2]!);
  }

  const sheetInfos: Array<{ name: string; path: string }> = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const sName = decodificarXml(m[1]!);
    const rid = m[2]!;
    const target = relMap.get(rid) ?? `worksheets/sheet${sheetInfos.length + 1}.xml`;
    const fullPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`;
    sheetInfos.push({ name: sName, path: fullPath });
  }

  // Fallback caso rels não case
  if (sheetInfos.length === 0) {
    for (const key of Object.keys(arquivos)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) {
        sheetInfos.push({ name: key.replace("xl/worksheets/", "").replace(".xml", ""), path: key });
      }
    }
  }

  const blocosFinais: string[] = [];
  let totalLinhasProcessadas = 0;

  for (const sheetInfo of sheetInfos) {
    const sheetXml = texto(sheetInfo.path);
    if (!sheetXml) continue;

    const matriz: string[][] = [];
    for (const linha of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const celulas: string[] = [];
      for (const c of (linha[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const ref = /\br="([A-Z]+\d*)"/i.exec(attrs)?.[1];
        const i = ref ? indiceDaColuna(ref) : celulas.length;
        while (celulas.length < i) celulas.push("");
        celulas[i] = valorDaCelula(attrs, c[2] ?? "", compartilhados);
      }
      if (celulas.some((v) => v.trim() !== "")) {
        matriz.push(celulas);
      }
    }

    if (matriz.length < 2) {
      // Menos de 2 linhas (ex: vazia ou só cabeçalho)
      continue;
    }

    const headers = matriz[0]!.map((h) => h.trim());
    const dataRows = matriz.slice(1);
    totalLinhasProcessadas += dataRows.length;

    if (totalLinhasProcessadas > XLSX_MAX_LINHAS_TOTAL) {
      throw new XlsxExtractError(
        `A planilha tem mais de ${XLSX_MAX_LINHAS_TOTAL} linhas no total. Reduza o volume de dados para indexação.`,
      );
    }

    const blocosDaAba: string[] = [`## Planilha: ${sheetInfo.name}`];

    // Transforma cada linha em bloco chave-valor para busca semântica ideal
    for (const row of dataRows) {
      const partes: string[] = [];
      headers.forEach((header, idx) => {
        const val = row[idx]?.trim();
        if (header && val) {
          partes.push(`${header}: ${val}`);
        }
      });
      if (partes.length > 0) {
        blocosDaAba.push(partes.join("\n"));
      }
    }

    if (blocosDaAba.length > 1) {
      blocosFinais.push(blocosDaAba.join("\n\n"));
    }
  }

  if (blocosFinais.length === 0) {
    throw new XlsxExtractError("A planilha não possui dados legíveis para indexação.");
  }

  return blocosFinais.join("\n\n---\n\n");
}
