import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { XlsxExtractError, extractXlsxText } from "@/lib/ai/rag/extractors/xlsx";

describe("extractXlsxText", () => {
  it("extrai dados da planilha com shared strings e formata em blocos chave-valor", () => {
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Produtos" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Nome</t></si>
  <si><t>Valor</t></si>
  <si><t>Cadeira Ergonomica</t></si>
</sst>`;

    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>850</v></c>
    </row>
  </sheetData>
</worksheet>`;

    const zip = zipSync({
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(relsXml),
      "xl/sharedStrings.xml": strToU8(sharedStringsXml),
      "xl/worksheets/sheet1.xml": strToU8(sheet1Xml),
    });

    const texto = extractXlsxText(Buffer.from(zip));
    expect(texto).toContain("## Planilha: Produtos");
    expect(texto).toContain("Nome: Cadeira Ergonomica");
    expect(texto).toContain("Valor: 850");
  });

  it("recusa arquivo vazio", () => {
    expect(() => extractXlsxText(Buffer.from(""))).toThrow(XlsxExtractError);
  });
});
