/**
 * PPTX (PowerPoint) text extractor for the RAG ingestion pipeline.
 *
 * Uses `fflate` to unzip the OpenXML package and extract slide titles,
 * body text, tables, and notes from `ppt/slides/slide*.xml`.
 *
 * Zero heavy external dependencies.
 */

import { strFromU8, unzipSync } from "fflate";

export class PptxExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PptxExtractError";
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

function extrairTextoDeSlideXml(xml: string): string[] {
  const paragrafos: string[] = [];
  // Procura por <a:p>...</a:p>
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  for (const match of xml.matchAll(pRegex)) {
    const pCorpo = match[1];
    if (!pCorpo) continue;

    // Extrai texto de <a:t>...</a:t>
    let pTexto = "";
    const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    for (const tMatch of pCorpo.matchAll(tRegex)) {
      if (tMatch[1]) {
        pTexto += decodificarXml(tMatch[1]);
      }
    }

    const limpo = pTexto.trim();
    if (limpo) {
      paragrafos.push(limpo);
    }
  }

  return paragrafos;
}

/**
 * Converte um buffer de arquivo .pptx em texto estruturado / Markdown.
 * Lança `PptxExtractError` se o arquivo estiver corrompido ou sem texto legível.
 */
export function extractPptxText(buffer: Buffer): string {
  if (buffer.byteLength === 0) {
    throw new PptxExtractError("O arquivo PPTX está vazio.");
  }

  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(new Uint8Array(buffer), {
      filter: (f) => f.name.startsWith("ppt/slides/slide") && f.name.endsWith(".xml"),
    });
  } catch (err) {
    throw new PptxExtractError(
      "Não consegui descompactar o arquivo PPTX. Certifique-se de que é uma apresentação válida.",
      err,
    );
  }

  const slideKeys = Object.keys(arquivos).sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
    return numA - numB;
  });

  if (slideKeys.length === 0) {
    throw new PptxExtractError("Apresentação PPTX sem slides encontrados.");
  }

  const slidesMarkdown: string[] = [];
  let totalTexto = 0;

  for (let i = 0; i < slideKeys.length; i++) {
    const key = slideKeys[i];
    if (!key) continue;
    const bytes = arquivos[key];
    if (!bytes) continue;

    const xml = strFromU8(bytes);
    const paragrafos = extrairTextoDeSlideXml(xml);
    if (paragrafos.length === 0) continue;

    const slideNum = i + 1;
    const corpoSlide = paragrafos.join("\n");
    totalTexto += corpoSlide.length;

    slidesMarkdown.push(`## Slide ${slideNum}\n${corpoSlide}`);
  }

  const resultado = slidesMarkdown.join("\n\n").trim();
  if (!resultado || totalTexto < 5) {
    throw new PptxExtractError(
      "Não foi possível extrair texto desta apresentação PPTX. Se os slides contiverem apenas imagens ou prints, envie uma versão com texto digital.",
    );
  }

  return resultado;
}
