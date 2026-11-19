/**
 * DOCX text extractor for the RAG ingestion pipeline.
 *
 * Uses `fflate` (already bundled in the project) to unzip the OpenXML package
 * and extract text, headings, and tables from `word/document.xml`.
 *
 * Zero heavy external dependencies (no mammoth, no docx-parser, no officegen).
 */

import { strFromU8, unzipSync } from "fflate";

export class DocxExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DocxExtractError";
  }
}

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

/** Extrai texto de todos os runs <w:r> de um bloco xml. */
function extrairTextoDeRuns(corpo: string): string {
  let out = "";
  // Procura por <w:t>, <w:tab/>, <w:br/>
  const regex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>/g;
  for (const m of corpo.matchAll(regex)) {
    if (m[1] !== undefined) {
      out += decodificarXml(m[1]);
    } else if (m[0].startsWith("<w:tab")) {
      out += "\t";
    } else if (m[0].startsWith("<w:br")) {
      out += "\n";
    }
  }
  return out;
}

/**
 * Converte um buffer de arquivo .docx em texto estruturado / Markdown.
 * Lança `DocxExtractError` se o arquivo estiver corrompido ou sem texto legível.
 */
export function extractDocxText(buffer: Buffer): string {
  if (buffer.byteLength === 0) {
    throw new DocxExtractError("O arquivo DOCX está vazio.");
  }

  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(new Uint8Array(buffer), {
      filter: (f) => f.name === "word/document.xml",
    });
  } catch (err) {
    throw new DocxExtractError("Não consegui descompactar o arquivo DOCX. Certifique-se de que é um documento válido.", err);
  }

  const docBytes = arquivos["word/document.xml"];
  if (!docBytes) {
    throw new DocxExtractError("Arquivo DOCX inválido (não contém word/document.xml).");
  }

  const xml = strFromU8(docBytes);
  const blocos: string[] = [];

  // Percorre elementos de primeiro nível no body: parágrafos (<w:p>) e tabelas (<w:tbl>)
  const corpoBody = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;

  // Processa elementos sequencialmente
  const elemRegex = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)|<w:tbl\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:tbl>)/g;
  for (const elem of corpoBody.matchAll(elemRegex)) {
    const pCorpo = elem[1];
    const tblCorpo = elem[2];

    if (pCorpo !== undefined) {
      // É um parágrafo
      const estilo = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/i.exec(pCorpo)?.[1] ?? "";
      const texto = extrairTextoDeRuns(pCorpo).trim();
      if (!texto) continue;

      let prefixo = "";
      if (/heading\s*1|^h1$/i.test(estilo) || /t[ií]tulo\s*1/i.test(estilo)) {
        prefixo = "# ";
      } else if (/heading\s*2|^h2$/i.test(estilo) || /t[ií]tulo\s*2/i.test(estilo)) {
        prefixo = "## ";
      } else if (/heading\s*3|^h3$/i.test(estilo) || /t[ií]tulo\s*3/i.test(estilo)) {
        prefixo = "### ";
      }

      blocos.push(`${prefixo}${texto}`);
    } else if (tblCorpo !== undefined) {
      // É uma tabela
      const linhas: string[][] = [];
      const trRegex = /<w:tr\b[^>]*?>([\s\S]*?)<\/w:tr>/g;
      for (const tr of tblCorpo.matchAll(trRegex)) {
        const celulas: string[] = [];
        const tcRegex = /<w:tc\b[^>]*?>([\s\S]*?)<\/w:tc>/g;
        for (const tc of (tr[1] ?? "").matchAll(tcRegex)) {
          const textoCelula = extrairTextoDeRuns(tc[1] ?? "").replace(/\s+/g, " ").trim();
          celulas.push(textoCelula);
        }
        if (celulas.some((c) => c.length > 0)) {
          linhas.push(celulas);
        }
      }

      if (linhas.length > 0) {
        // Converte para tabela Markdown
        const maxCols = Math.max(...linhas.map((l) => l.length));
        const formatadas: string[] = [];
        linhas.forEach((linha, idx) => {
          while (linha.length < maxCols) linha.push("");
          formatadas.push(`| ${linha.join(" | ")} |`);
          if (idx === 0) {
            formatadas.push(`| ${Array(maxCols).fill("---").join(" | ")} |`);
          }
        });
        blocos.push(formatadas.join("\n"));
      }
    }
  }

  const resultado = blocos.join("\n\n").trim();
  if (resultado.length === 0) {
    throw new DocxExtractError("O documento DOCX não possui texto legível para indexar.");
  }

  return resultado;
}
