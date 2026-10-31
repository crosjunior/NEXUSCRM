import { describe, it, expect } from "vitest";
import { slugifyEmpresa, isReservedSlug } from "./slug";

describe("slugifyEmpresa", () => {
  it("remove espaços, acentos e pontuação, gerando slug contínuo", () => {
    expect(slugifyEmpresa("Nexus Strategy")).toBe("nexusstrategy");
    expect(slugifyEmpresa("Clínica São José & Associados")).toBe("clinicasaojoseassociados");
    expect(slugifyEmpresa("Loja 100% Fitness!")).toBe("loja100fitness");
    expect(slugifyEmpresa("  Empresa   com    Espaços   ")).toBe("empresacomespacos");
  });

  it("retorna fallback se o nome for apenas caracteres inválidos", () => {
    expect(slugifyEmpresa("!@#$%^&*()")).toBe("empresa");
  });

  it("identifica slugs reservados do sistema", () => {
    expect(isReservedSlug("app")).toBe(true);
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("login")).toBe(true);
    expect(isReservedSlug("minhaempresa")).toBe(false);
  });
});
