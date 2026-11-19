import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { DocxExtractError, extractDocxText } from "@/lib/ai/rag/extractors/docx";

describe("extractDocxText", () => {
  it("extrai texto de parágrafos simples e títulos", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Manual de Atendimento</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Nosso horário de funcionamento é das 8h às 18h.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const zip = zipSync({
      "word/document.xml": strToU8(xml),
    });

    const texto = extractDocxText(Buffer.from(zip));
    expect(texto).toContain("# Manual de Atendimento");
    expect(texto).toContain("Nosso horário de funcionamento é das 8h às 18h.");
  });

  it("extrai tabelas e formata como tabela Markdown", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Produto</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Preço</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Plano Pro</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>R$ 199</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = zipSync({
      "word/document.xml": strToU8(xml),
    });

    const texto = extractDocxText(Buffer.from(zip));
    expect(texto).toContain("| Produto | Preço |");
    expect(texto).toContain("| Plano Pro | R$ 199 |");
  });

  it("recusa arquivo vazio ou corrompido", () => {
    expect(() => extractDocxText(Buffer.from(""))).toThrow(DocxExtractError);
    expect(() => extractDocxText(Buffer.from("isto nao e um zip"))).toThrow(DocxExtractError);
  });
});
