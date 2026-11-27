import { describe, expect, it } from "vitest";
import {
  MODULOS_TENANT_TODOS,
  RECURSOS_TENANT_TODOS,
  modulosHabilitadosDaOrganizacao,
  recursosHabilitadosDaOrganizacao,
  moduloTenantDaRota,
  recursoTenantDaRota,
  rotaPermitidaPelosModulos,
  resolverDependenciasAoAtivar,
  resolverDependenciasAoDesativar,
} from "./modulos-contratados";

describe("modulosHabilitadosDaOrganizacao", () => {
  it("devolve todos os 7 módulos se settings for nulo, indefinido ou vazio (retrocompatibilidade)", () => {
    expect(modulosHabilitadosDaOrganizacao(null)).toEqual(MODULOS_TENANT_TODOS);
    expect(modulosHabilitadosDaOrganizacao(undefined)).toEqual(MODULOS_TENANT_TODOS);
    expect(modulosHabilitadosDaOrganizacao({})).toEqual(MODULOS_TENANT_TODOS);
    expect(modulosHabilitadosDaOrganizacao({ outro_campo: 123 })).toEqual(MODULOS_TENANT_TODOS);
  });

  it("devolve apenas os módulos contratados quando explicitamente configurados", () => {
    const settings = {
      modulos_habilitados: ["crm", "inbox"],
    };
    expect(modulosHabilitadosDaOrganizacao(settings)).toEqual(["crm", "inbox"]);
  });

  it("ignora strings desconhecidas ou inválidas", () => {
    const settings = {
      modulos_habilitados: ["crm", "invalido", 123, "connections"],
    };
    expect(modulosHabilitadosDaOrganizacao(settings)).toEqual(["crm", "connections"]);
  });
});

describe("recursosHabilitadosDaOrganizacao", () => {
  it("devolve todos os recursos dos módulos habilitados quando settings não define recursos (retrocompatibilidade)", () => {
    const recursos = recursosHabilitadosDaOrganizacao(null, ["inbox"]);
    expect(recursos).toContain("inbox_chat");
    expect(recursos).toContain("inbox_manual_reply");
    expect(recursos).not.toContain("crm_kanban");
  });

  it("filtra recursos estritamente pelos recursos salvos no settings", () => {
    const settings = {
      modulos_habilitados: ["crm"],
      recursos_habilitados: ["crm_kanban", "crm_contacts"],
    };
    const recursos = recursosHabilitadosDaOrganizacao(settings, ["crm"]);
    expect(recursos).toEqual(["crm_kanban", "crm_contacts"]);
    expect(recursos).not.toContain("crm_proposals");
  });

  it("exclui recursos cujos módulos pai foram desativados", () => {
    const settings = {
      modulos_habilitados: ["inbox"], // CRM não está ativo
      recursos_habilitados: ["inbox_chat", "crm_proposals"],
    };
    const recursos = recursosHabilitadosDaOrganizacao(settings, ["inbox"]);
    expect(recursos).toEqual(["inbox_chat"]);
    expect(recursos).not.toContain("crm_proposals");
  });
});

describe("moduloTenantDaRota e recursoTenantDaRota", () => {
  it("classifica rotas de CRM e mapeia seus recursos individuais", () => {
    expect(moduloTenantDaRota("/app/crm")).toBe("crm");
    expect(recursoTenantDaRota("/app/crm")).toBe("crm_kanban");
    expect(recursoTenantDaRota("/app/kanban")).toBe("crm_kanban");
    expect(recursoTenantDaRota("/app/contacts")).toBe("crm_contacts");
    expect(recursoTenantDaRota("/app/tasks")).toBe("crm_tasks");
    expect(recursoTenantDaRota("/app/products")).toBe("crm_products");
    expect(recursoTenantDaRota("/app/proposals")).toBe("crm_proposals");
    expect(recursoTenantDaRota("/app/campaigns")).toBe("crm_campaigns");
  });

  it("classifica rotas de Agentes de IA e Base de Conhecimento", () => {
    expect(moduloTenantDaRota("/app/ai/agents")).toBe("ai_agents");
    expect(recursoTenantDaRota("/app/ai/agents")).toBe("ai_agents_config");
    expect(recursoTenantDaRota("/app/ai/followups")).toBe("ai_followups");
    expect(recursoTenantDaRota("/app/ai/routers")).toBe("ai_routers");
    expect(recursoTenantDaRota("/app/ai/cases")).toBe("ai_cases");
    expect(recursoTenantDaRota("/app/ai/knowledge")).toBe("kb_documents");
    expect(recursoTenantDaRota("/app/ai/knowledge/sources")).toBe("kb_sources");
  });

  it("classifica rotas de Atendimento e Conexões", () => {
    expect(recursoTenantDaRota("/app/agenda")).toBe("atendimento_agenda");
    expect(recursoTenantDaRota("/app/templates")).toBe("atendimento_templates");
    expect(recursoTenantDaRota("/app/radar")).toBe("atendimento_radar");
    expect(recursoTenantDaRota("/app/connections")).toBe("conn_whatsapp");
    expect(recursoTenantDaRota("/app/flows")).toBe("conn_flows");
    expect(recursoTenantDaRota("/app/webhooks")).toBe("conn_webhooks");
  });

  it("devolve null para rotas essenciais", () => {
    expect(moduloTenantDaRota("/app/settings/profile")).toBeNull();
    expect(recursoTenantDaRota("/app/settings/profile")).toBeNull();
    expect(moduloTenantDaRota("/app/team")).toBeNull();
  });
});

describe("rotaPermitidaPelosModulos com granularidade de recursos", () => {
  it("libera rota se o módulo e o recurso estiverem habilitados", () => {
    expect(
      rotaPermitidaPelosModulos("/app/proposals", ["crm"], ["crm_kanban", "crm_proposals"]),
    ).toBe(true);
  });

  it("bloqueia rota se o módulo estiver ativo mas o recurso específico for desmarcado", () => {
    expect(
      rotaPermitidaPelosModulos("/app/proposals", ["crm"], ["crm_kanban", "crm_contacts"]),
    ).toBe(false);

    // Mas a rota de contatos continua liberada
    expect(
      rotaPermitidaPelosModulos("/app/contacts", ["crm"], ["crm_kanban", "crm_contacts"]),
    ).toBe(true);
  });

  it("bloqueia rota se o módulo estiver desativado mesmo se o recurso estivesse na lista", () => {
    expect(
      rotaPermitidaPelosModulos("/app/proposals", ["inbox"], ["crm_proposals"]),
    ).toBe(false);
  });
});

describe("Dependências entre recursos (ativação e desativação)", () => {
  it("ativa dependências necessárias automaticamente ao ativar um recurso", () => {
    const recursos = new Set<string>();
    const modulos = new Set<any>();

    // Ativar propostas (que requer crm_contacts e crm_products)
    const { recursosAdicionados, modulosAdicionados } = resolverDependenciasAoAtivar(
      "crm_proposals",
      recursos,
      modulos,
    );

    expect(recursos.has("crm_proposals")).toBe(true);
    expect(recursos.has("crm_contacts")).toBe(true);
    expect(recursos.has("crm_products")).toBe(true);
    expect(modulos.has("crm")).toBe(true);
    expect(recursosAdicionados).toContain("crm_contacts");
    expect(recursosAdicionados).toContain("crm_products");
  });

  it("desativa recursos dependentes em cadeia ao desativar uma dependência", () => {
    // Organização com todos os recursos do CRM ativos
    const recursos = new Set<string>([
      "crm_kanban",
      "crm_contacts",
      "crm_tasks",
      "crm_products",
      "crm_proposals",
      "crm_campaigns",
    ]);

    // Desativa crm_contacts
    const { recursosRemovidos } = resolverDependenciasAoDesativar("crm_contacts", recursos);

    expect(recursos.has("crm_contacts")).toBe(false);
    // crm_tasks, crm_proposals e crm_campaigns dependiam de crm_contacts
    expect(recursos.has("crm_tasks")).toBe(false);
    expect(recursos.has("crm_proposals")).toBe(false);
    expect(recursos.has("crm_campaigns")).toBe(false);

    // crm_kanban e crm_products não dependem de contatos e continuam ativos
    expect(recursos.has("crm_kanban")).toBe(true);
    expect(recursos.has("crm_products")).toBe(true);
  });
});
