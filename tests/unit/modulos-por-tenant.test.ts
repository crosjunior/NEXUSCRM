import { describe, expect, it } from "vitest";
import { destinosDaInterface } from "@/lib/navigation/interface";
import { sidebarGroups, searchable } from "@/lib/navigation/registry";
import {
  MODULOS_TENANT_TODOS,
  RECURSOS_TENANT_TODOS,
  type ModuloTenant,
} from "@/lib/tenants/modulos-contratados";

describe("Navegação com restrição de módulos por tenant", () => {
  it("mostra todos os destinos quando a empresa possui todos os módulos liberados", () => {
    const destinos = destinosDaInterface({}, false, "admin", undefined, undefined, MODULOS_TENANT_TODOS);
    const hrefs = destinos.map((d) => d.href);

    expect(hrefs).toContain("/app/contacts");
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/agenda");
    expect(hrefs).toContain("/app/ai/agents");
    expect(hrefs).toContain("/app/ai/knowledge/sources");
    expect(hrefs).toContain("/app/metrics");
    expect(hrefs).toContain("/app/connections");
    // Rotas essenciais sempre presentes
    expect(hrefs).toContain("/app/settings/profile");
    expect(hrefs).toContain("/app/team");
  });

  it("oculta destinos de CRM quando o módulo crm está desabilitado para o tenant", () => {
    const modulos: ModuloTenant[] = ["inbox", "atendimento", "connections"];
    const destinos = destinosDaInterface({}, false, "admin", undefined, undefined, modulos);
    const hrefs = destinos.map((d) => d.href);

    // CRM oculto
    expect(hrefs).not.toContain("/app/contacts");
    expect(hrefs).not.toContain("/app/kanban");
    expect(hrefs).not.toContain("/app/tasks");
    expect(hrefs).not.toContain("/app/proposals");

    // Liberados continuam presentes
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/agenda");
    expect(hrefs).toContain("/app/connections");

    // Essenciais continuam presentes
    expect(hrefs).toContain("/app/team");
    expect(hrefs).toContain("/app/settings/profile");
  });

  it("remove o grupo CRM do menu lateral quando todos os destinos de CRM forem ocultados", () => {
    const modulos: ModuloTenant[] = ["inbox", "atendimento", "connections"];
    const grupos = sidebarGroups(false, "admin", undefined, undefined, undefined, modulos);
    const gruposIds = grupos.map((g) => g.group.id);

    expect(gruposIds).not.toContain("crm");
    expect(gruposIds).toContain("atendimento");
    expect(gruposIds).toContain("canais");
  });

  it("oculta destinos de IA quando ai_agents e knowledge_base estão desabilitados", () => {
    const modulos: ModuloTenant[] = ["crm", "inbox", "dashboard"];
    const destinos = destinosDaInterface({}, false, "admin", undefined, undefined, modulos);
    const hrefs = destinos.map((d) => d.href);

    expect(hrefs).not.toContain("/app/ai/agents");
    expect(hrefs).not.toContain("/app/ai/knowledge/sources");
    expect(hrefs).toContain("/app/contacts");
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/metrics");
  });

  it("não vaza destinos desabilitados no ⌘K (searchable)", () => {
    const modulos: ModuloTenant[] = ["inbox"];
    const busca = searchable(false, "admin", undefined, undefined, undefined, modulos);
    const hrefs = busca.map((d) => d.href);

    expect(hrefs).not.toContain("/app/contacts");
    expect(hrefs).not.toContain("/app/ai/agents");
    expect(hrefs).not.toContain("/app/metrics");
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/settings/profile");
  });

  it("platform admin visualiza todos os destinos mesmo se desabilitados para o tenant", () => {
    const modulos: ModuloTenant[] = []; // nenhum liberado para tenant comum
    const destinos = destinosDaInterface({}, true, null, undefined, undefined, modulos);
    const hrefs = destinos.map((d) => d.href);

    expect(hrefs).toContain("/app/contacts");
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/ai/agents");
    expect(hrefs).toContain("/app/connections");
  });
});

describe("Navegação com restrição de RECURSOS individuais por tenant", () => {
  it("oculta apenas os recursos individuais desmarcados dentro de um módulo ativo", () => {
    const modulos: ModuloTenant[] = ["crm", "inbox"];
    // CRM ativo, mas crm_proposals e crm_tasks desmarcados
    const recursos: string[] = ["crm_kanban", "crm_contacts", "crm_products", "inbox_chat"];

    const destinos = destinosDaInterface({}, false, "admin", undefined, undefined, modulos, recursos);
    const hrefs = destinos.map((d) => d.href);

    // Recursos desmarcados não aparecem
    expect(hrefs).not.toContain("/app/proposals");
    expect(hrefs).not.toContain("/app/tasks");

    // Recursos liberados do CRM aparecem normalmente
    expect(hrefs).toContain("/app/contacts");
    expect(hrefs).toContain("/app/kanban");
    expect(hrefs).toContain("/app/products");

    // Outros módulos liberados
    expect(hrefs).toContain("/app/inbox");
  });

  it("filtra recursos desmarcados da barra lateral (sidebar) mantendo o grupo se houver outros recursos", () => {
    const modulos: ModuloTenant[] = ["crm"];
    // Apenas Kanban ativo no CRM
    const recursos: string[] = ["crm_kanban"];

    const grupos = sidebarGroups(false, "admin", undefined, undefined, undefined, modulos, recursos);
    const grupoCrm = grupos.find((g) => g.group.id === "crm");

    expect(grupoCrm).toBeDefined();
    const crmHrefs = grupoCrm!.items.map((i) => i.href);
    expect(crmHrefs).toContain("/app/kanban");
    expect(crmHrefs).not.toContain("/app/contacts");
    expect(crmHrefs).not.toContain("/app/tasks");
  });

  it("remove recursos individuais desmarcados da busca ⌘K (searchable)", () => {
    const modulos: ModuloTenant[] = ["crm"];
    const recursos: string[] = ["crm_kanban", "crm_contacts"];

    const busca = searchable(false, "admin", undefined, undefined, undefined, modulos, recursos);
    const hrefs = busca.map((d) => d.href);

    expect(hrefs).toContain("/app/contacts");
    expect(hrefs).not.toContain("/app/proposals");
    expect(hrefs).not.toContain("/app/tasks");
  });
});
