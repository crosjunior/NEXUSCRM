import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractPptxText, PptxExtractError } from "@/lib/ai/rag/extractors/pptx";

describe("extractPptxText", () => {
  it("extrai texto de slides ordenados", () => {
    const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              <a:p><a:t>Apresentação do Projeto</a:t></a:p>
              <a:p><a:t>Subtítulo do empreendimento</a:t></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`;

    const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              <a:p><a:t>Valores e Condições</a:t></a:p>
              <a:p><a:t>Lojas a partir de R$ 5.000/m²</a:t></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`;

    const zipData = zipSync({
      "ppt/slides/slide2.xml": strToU8(slide2Xml),
      "ppt/slides/slide1.xml": strToU8(slide1Xml),
    });

    const buffer = Buffer.from(zipData);
    const resultado = extractPptxText(buffer);

    expect(resultado).toContain("## Slide 1");
    expect(resultado).toContain("Apresentação do Projeto");
    expect(resultado).toContain("Subtítulo do empreendimento");
    expect(resultado).toContain("## Slide 2");
    expect(resultado).toContain("Valores e Condições");
    expect(resultado).toContain("Lojas a partir de R$ 5.000/m²");
  });

  it("rejeita PPTX sem slides ou vazio", () => {
    expect(() => extractPptxText(Buffer.from([]))).toThrow(PptxExtractError);

    const zipVazio = zipSync({ "other.txt": strToU8("nada") });
    expect(() => extractPptxText(Buffer.from(zipVazio))).toThrow(PptxExtractError);
  });
});
