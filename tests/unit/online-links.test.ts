import { describe, expect, it } from "vitest";
import {
  detectProvider,
  resolveDirectUrl,
} from "@/lib/ai/rag/extractors/online-links";

describe("online-links", () => {
  it("detecta links do Google Drive e Docs", () => {
    expect(detectProvider("https://drive.google.com/file/d/12345/view")).toBe("gdrive");
    expect(detectProvider("https://docs.google.com/document/d/abcdef/edit")).toBe("gdrive");
    expect(detectProvider("https://docs.google.com/spreadsheets/d/xyz123/edit")).toBe("gdrive");
  });

  it("detecta links do OneDrive e SharePoint", () => {
    expect(detectProvider("https://1drv.ms/u/s!Am8x")).toBe("onedrive");
    expect(detectProvider("https://empresa.sharepoint.com/:x:/g/personal/arquivo.xlsx")).toBe("onedrive");
  });

  it("converte Google Docs para endpoint de exportação de texto", () => {
    const res = resolveDirectUrl("https://docs.google.com/document/d/DOC_ID_123/edit?usp=sharing");
    expect(res.directUrl).toBe("https://docs.google.com/document/d/DOC_ID_123/export?format=txt");
    expect(res.ext).toBe("txt");
  });

  it("converte Google Sheets para endpoint de exportação CSV", () => {
    const res = resolveDirectUrl("https://docs.google.com/spreadsheets/d/SHEET_ID_456/edit#gid=0");
    expect(res.directUrl).toBe("https://docs.google.com/spreadsheets/d/SHEET_ID_456/export?format=csv");
    expect(res.ext).toBe("csv");
  });

  it("converte Google Drive file para download direto", () => {
    const res = resolveDirectUrl("https://drive.google.com/file/d/FILE_ID_789/view?usp=sharing");
    expect(res.directUrl).toBe("https://drive.google.com/uc?export=download&id=FILE_ID_789");
  });

  it("adiciona parâmetro download=1 para links do OneDrive", () => {
    const res = resolveDirectUrl("https://1drv.ms/u/s!Am8x123");
    expect(res.directUrl).toBe("https://1drv.ms/u/s!Am8x123?download=1");
  });
});
