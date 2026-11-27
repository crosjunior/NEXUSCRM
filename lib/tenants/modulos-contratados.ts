/**
 * Módulos de negócio e Recursos individuais contratados por Tenant (Empresa).
 *
 * Permite que o administrador da plataforma libere ou oculte funcionalidades e recursos
 * individualmente para uma determinada organização com base no plano, contratação ou necessidade do cliente.
 *
 * Pilares do sistema:
 * 1. crm: Gestão de Leads, Clientes, Funis, Negócios, Tarefas e Propostas.
 * 2. inbox: Conversas em um único lugar, filtros multicanal, resposta manual.
 * 3. atendimento: Operação diária, Agenda de horários, Respostas rápidas e Radar.
 * 4. ai_agents: Configuração de Agentes de IA, prompts, modelos, follow-ups e casos.
 * 5. knowledge_base: Bases de conhecimento (materiais e links consultados pelos agentes).
 * 6. dashboard: Indicadores, Desempenho, Atividades, Meta Ads e relatórios.
 * 7. connections: Conexão de números WhatsApp (multi-engine) e Instagram.
 */

export const MODULOS_TENANT = [
  "crm",
  "inbox",
  "atendimento",
  "ai_agents",
  "knowledge_base",
  "dashboard",
  "connections",
] as const;

export type ModuloTenant = (typeof MODULOS_TENANT)[number];

export interface RecursoTenantInfo {
  id: string;
  moduloId: ModuloTenant;
  nome: string;
  descricao: string;
  rotas: string[];
  dependencias: string[]; // IDs de outros recursos necessários
}

export interface ModuloTenantInfo {
  id: ModuloTenant;
  nome: string;
  pilar: string;
  descricao: string;
  recursos: RecursoTenantInfo[];
  rotas: string[];
}

export const MODULOS_TENANT_TODOS: readonly ModuloTenant[] = Object.freeze([
  "crm",
  "inbox",
  "atendimento",
  "ai_agents",
  "knowledge_base",
  "dashboard",
  "connections",
]);

/** Catálogo completo de Recursos individuais disponíveis por Módulo */
export const RECURSOS_TENANT_CATALOGO: Record<string, RecursoTenantInfo> = {
  // === CRM ===
  crm_kanban: {
    id: "crm_kanban",
    moduloId: "crm",
    nome: "Funis de Vendas (Kanban)",
    descricao: "Gestão visual do funil de vendas, etapas de negociação e movimentação de negócios.",
    rotas: ["/app/kanban", "/app/crm", "/app/deals", "/app/settings/tenant/pipelines"],
    dependencias: [],
  },
  crm_contacts: {
    id: "crm_contacts",
    moduloId: "crm",
    nome: "Gestão de Contatos & Leads",
    descricao: "Cadastro de clientes, contatos, empresas associadas e importação de bases de leads.",
    rotas: ["/app/contacts", "/app/companies", "/app/people", "/app/imports"],
    dependencias: [],
  },
  crm_tasks: {
    id: "crm_tasks",
    moduloId: "crm",
    nome: "Tarefas & Planos de Tarefas",
    descricao: "Criação de tarefas, agendamento de atividades comerciais e planos de tarefas para clientes.",
    rotas: ["/app/tasks", "/app/tasks/planos"],
    dependencias: ["crm_contacts"],
  },
  crm_products: {
    id: "crm_products",
    moduloId: "crm",
    nome: "Produtos & Catálogo de Preços",
    descricao: "Cadastro de catálogo de produtos, serviços e tabelas de preços vendáveis.",
    rotas: ["/app/products"],
    dependencias: [],
  },
  crm_proposals: {
    id: "crm_proposals",
    moduloId: "crm",
    nome: "Propostas Comerciais & Modelos",
    descricao: "Emissão de propostas em PDF, templates comerciais personalizados e vinculação com produtos.",
    rotas: [
      "/app/proposals",
      "/app/settings/tenant/proposals",
      "/app/settings/tenant/proposals/modelos",
    ],
    dependencias: ["crm_contacts", "crm_products"],
  },
  crm_campaigns: {
    id: "crm_campaigns",
    moduloId: "crm",
    nome: "Campanhas & Prospecção",
    descricao: "Listas de transmissão, campanhas ativas, prospecção e registro de ligações comerciais.",
    rotas: ["/app/campaigns", "/app/prospecting", "/app/calls", "/app/comandas"],
    dependencias: ["crm_contacts"],
  },

  // === INBOX ===
  inbox_chat: {
    id: "inbox_chat",
    moduloId: "inbox",
    nome: "Inbox Multicanal Unificada",
    descricao: "Painel centralizado de conversas do WhatsApp e Instagram com filtros de funil e leitura.",
    rotas: ["/app/inbox"],
    dependencias: [],
  },
  inbox_manual_reply: {
    id: "inbox_manual_reply",
    moduloId: "inbox",
    nome: "Atendimento Manual Humano",
    descricao: "Digitação e envio de mensagens manuais pelo atendente diretamente nas conversas.",
    rotas: [],
    dependencias: ["inbox_chat"],
  },
  inbox_queue_handoff: {
    id: "inbox_queue_handoff",
    moduloId: "inbox",
    nome: "Fila de Atendimento & Handoff",
    descricao: "Distribuição da fila de espera e transferência de clientes para outros membros da equipe.",
    rotas: [],
    dependencias: ["inbox_chat"],
  },

  // === ATENDIMENTO ===
  atendimento_agenda: {
    id: "atendimento_agenda",
    moduloId: "atendimento",
    nome: "Agenda de Horários & Compromissos",
    descricao: "Calendário de compromissos, agendamentos automáticos e tipos de serviço no WhatsApp.",
    rotas: ["/app/agenda", "/app/agenda/avisos", "/app/settings/tenant/agenda"],
    dependencias: [],
  },
  atendimento_templates: {
    id: "atendimento_templates",
    moduloId: "atendimento",
    nome: "Respostas Rápidas (Templates)",
    descricao: "Atalhos de texto e mensagens rápidas pré-configuradas para os atendentes.",
    rotas: ["/app/templates"],
    dependencias: [],
  },
  atendimento_radar: {
    id: "atendimento_radar",
    moduloId: "atendimento",
    nome: "Radar de Clientes & Esfriamento",
    descricao: "Identificação proativa de conversas pendentes ou que esfriaram para resgate comercial.",
    rotas: ["/app/radar"],
    dependencias: [],
  },
  atendimento_distribuicao: {
    id: "atendimento_distribuicao",
    moduloId: "atendimento",
    nome: "Regras de Distribuição & Rodízio",
    descricao: "Roteamento inteligente de leads e distribuição equilibrada de conversas na equipe.",
    rotas: ["/app/settings/atendimento"],
    dependencias: [],
  },

  // === AGENTES DE IA ===
  ai_agents_config: {
    id: "ai_agents_config",
    moduloId: "ai_agents",
    nome: "Configuração de Agentes de IA",
    descricao: "Criação de agentes virtuais, instruções de prompt, escolha de modelos e credenciais.",
    rotas: [
      "/app/ai",
      "/app/ai/agents",
      "/app/ai/credentials",
      "/app/ai/providers",
      "/app/onboarding-ia",
    ],
    dependencias: [],
  },
  ai_followups: {
    id: "ai_followups",
    moduloId: "ai_agents",
    nome: "Follow-ups Automáticos",
    descricao: "Mensagens automáticas de reengajamento inteligente quando o cliente para de responder.",
    rotas: ["/app/ai/followups"],
    dependencias: ["ai_agents_config"],
  },
  ai_routers: {
    id: "ai_routers",
    moduloId: "ai_agents",
    nome: "Roteadores Inteligentes de Conversa",
    descricao: "Classificação automática da intenção do lead para direcionar ao agente ou departamento certo.",
    rotas: ["/app/ai/routers", "/app/ai/atendimento"],
    dependencias: ["ai_agents_config"],
  },
  ai_cases: {
    id: "ai_cases",
    moduloId: "ai_agents",
    nome: "Casos de Atendimento & Avisos",
    descricao: "Registro de ocorrências críticas tratadas pelo agente e avisos imediatos ao time.",
    rotas: ["/app/ai/cases", "/app/ai/cases/avisos"],
    dependencias: ["ai_agents_config"],
  },
  ai_skills_memory: {
    id: "ai_skills_memory",
    moduloId: "ai_agents",
    nome: "Memória Operacional & Ferramentas",
    descricao: "Persistência de fatos e memória da organização com acionamento de skills no turno.",
    rotas: ["/app/ai/memory", "/app/ai/skills"],
    dependencias: ["ai_agents_config"],
  },
  ai_diagnostic: {
    id: "ai_diagnostic",
    moduloId: "ai_agents",
    nome: "Diagnóstico, Execuções & Custos",
    descricao: "Histórico detalhado de turnos, custos em tempo real, tokens e depuração de IA.",
    rotas: ["/app/ai/runs", "/app/ai/usage", "/app/ai/inbox"],
    dependencias: ["ai_agents_config"],
  },

  // === BASES DE CONHECIMENTO ===
  kb_documents: {
    id: "kb_documents",
    moduloId: "knowledge_base",
    nome: "Documentos & Arquivos (Uploads)",
    descricao: "Upload de arquivos, manuais e PDFs de treinamento consultados pelo agente com RAG.",
    rotas: ["/app/ai/knowledge"],
    dependencias: [],
  },
  kb_sources: {
    id: "kb_sources",
    moduloId: "knowledge_base",
    nome: "Fontes Externas & Links Web",
    descricao: "Indexação de sites institucionais, links e fontes externas para os agentes.",
    rotas: ["/app/ai/knowledge/sources"],
    dependencias: ["kb_documents"],
  },

  // === DASHBOARD & INDICADORES ===
  dash_performance: {
    id: "dash_performance",
    moduloId: "dashboard",
    nome: "Dashboard de Desempenho & Funil",
    descricao: "Painel analítico com taxas de conversão de leads, volumes de contato e funil de vendas.",
    rotas: ["/app/dashboard", "/app/analise", "/app/metrics"],
    dependencias: [],
  },
  dash_activities: {
    id: "dash_activities",
    moduloId: "dashboard",
    nome: "Relatório de Atividades da Equipe",
    descricao: "Histórico de ações, atendimentos e interações executadas por cada membro.",
    rotas: ["/app/activities"],
    dependencias: [],
  },
  dash_meta_ads: {
    id: "dash_meta_ads",
    moduloId: "dashboard",
    nome: "Métricas de Anúncios (Meta Ads)",
    descricao: "Relatório de leads gerados por campanhas do Facebook e Instagram Ads.",
    rotas: ["/app/ads", "/app/ads/meta"],
    dependencias: [],
  },
  dash_ai_evolution: {
    id: "dash_ai_evolution",
    moduloId: "dashboard",
    nome: "Evolução & Precisão da IA",
    descricao: "Indicadores de assertividade, taxa de resolução automática e intervenções humanas.",
    rotas: ["/app/ai/evolution"],
    dependencias: [],
  },
  dash_financial: {
    id: "dash_financial",
    moduloId: "dashboard",
    nome: "Metas de Vendas & Faturamento",
    descricao: "Controle de metas de faturamento, honorários e desempenho financeiro comercial.",
    rotas: ["/app/faturamento", "/app/honorarios", "/app/settings/metas"],
    dependencias: [],
  },

  // === CONEXÕES ===
  conn_whatsapp: {
    id: "conn_whatsapp",
    moduloId: "connections",
    nome: "Conexões WhatsApp & Instagram",
    descricao: "Pareamento via QR Code (Evolution API, WAHA, Uaizap) e conexão Oficial (Meta Cloud API).",
    rotas: ["/app/connections"],
    dependencias: [],
  },
  conn_flows: {
    id: "conn_flows",
    moduloId: "connections",
    nome: "Fluxos Visuais de Automação",
    descricao: "Construção de fluxos em árvore visual e automações de disparo de mensagens.",
    rotas: ["/app/flows"],
    dependencias: ["conn_whatsapp"],
  },
  conn_webhooks: {
    id: "conn_webhooks",
    moduloId: "connections",
    nome: "Webhooks para Sistemas Externos",
    descricao: "Disparo e recepção de eventos HTTP via webhook para integração com outros sistemas.",
    rotas: ["/app/webhooks"],
    dependencias: [],
  },
  conn_ecommerce: {
    id: "conn_ecommerce",
    moduloId: "connections",
    nome: "Integrações E-commerce (Nuvemshop)",
    descricao: "Sincronização de pedidos, status e catálogo de produtos com lojas virtuais.",
    rotas: ["/app/integrations", "/app/integrations/nuvemshop"],
    dependencias: [],
  },
};

export const RECURSOS_TENANT_TODOS: readonly string[] = Object.freeze(
  Object.keys(RECURSOS_TENANT_CATALOGO),
);

/** Retorna a lista de recursos que pertencem a um determinado módulo */
export function recursosPorModulo(moduloId: ModuloTenant): RecursoTenantInfo[] {
  return Object.values(RECURSOS_TENANT_CATALOGO).filter((r) => r.moduloId === moduloId);
}

export const MODULOS_TENANT_CATALOGO: Record<ModuloTenant, ModuloTenantInfo> = {
  crm: {
    id: "crm",
    nome: "CRM (Gestão de Leads & Funil)",
    pilar: "Vendas & CRM",
    descricao:
      "Controle e gestão de clientes e leads, acompanhamento do funil desde lead capturado sem contato (frio) até o envio de proposta comercial, tarefas, negócios e catálogo.",
    recursos: recursosPorModulo("crm"),
    rotas: [
      "/app/crm",
      "/app/kanban",
      "/app/contacts",
      "/app/tasks",
      "/app/tasks/planos",
      "/app/deals",
      "/app/companies",
      "/app/people",
      "/app/products",
      "/app/proposals",
      "/app/settings/tenant/proposals",
      "/app/settings/tenant/proposals/modelos",
      "/app/settings/tenant/pipelines",
      "/app/prospecting",
      "/app/campaigns",
      "/app/comandas",
      "/app/imports",
      "/app/calls",
    ],
  },
  inbox: {
    id: "inbox",
    nome: "Conversas (Inbox Unificada)",
    pilar: "Atendimento ao Cliente",
    descricao:
      "Página para visualizar todas as conversas em um único lugar, separando por status do funil, canal (WhatsApp ou Instagram), lidas e não lidas, com resposta manual direta.",
    recursos: recursosPorModulo("inbox"),
    rotas: ["/app/inbox"],
  },
  atendimento: {
    id: "atendimento",
    nome: "Atendimento (Agenda & Operação)",
    pilar: "Operação de Atendimento",
    descricao:
      "Gestão diária da operação de atendimento: agenda de horários, respostas rápidas para o atendente, radar de clientes abertos sem resposta e distribuição de atendimento.",
    recursos: recursosPorModulo("atendimento"),
    rotas: [
      "/app/agenda",
      "/app/agenda/avisos",
      "/app/settings/tenant/agenda",
      "/app/templates",
      "/app/radar",
      "/app/settings/atendimento",
    ],
  },
  ai_agents: {
    id: "ai_agents",
    nome: "Agentes de IA (Chatbot Inteligente)",
    pilar: "Inteligência Artificial",
    descricao:
      "Configuração dos agentes de IA que atendem os leads no WhatsApp e Instagram, instruções, modelos de IA, ferramentas, follow-ups automáticos e acompanhamento de casos.",
    recursos: recursosPorModulo("ai_agents"),
    rotas: [
      "/app/ai",
      "/app/ai/agents",
      "/app/ai/followups",
      "/app/ai/routers",
      "/app/ai/atendimento",
      "/app/ai/credentials",
      "/app/ai/providers",
      "/app/ai/cases",
      "/app/ai/cases/avisos",
      "/app/ai/inbox",
      "/app/ai/proposals",
      "/app/ai/runs",
      "/app/ai/usage",
      "/app/ai/memory",
      "/app/ai/skills",
      "/app/onboarding-ia",
    ],
  },
  knowledge_base: {
    id: "knowledge_base",
    nome: "Bases de Conhecimento",
    pilar: "Inteligência Artificial",
    descricao:
      "Configuração e upload de materiais, documentos, arquivos e links que os agentes de IA consultam para responder sobre o seu negócio com precisão.",
    recursos: recursosPorModulo("knowledge_base"),
    rotas: ["/app/ai/knowledge", "/app/ai/knowledge/sources"],
  },
  dashboard: {
    id: "dashboard",
    nome: "Dashboard & Indicadores (Análise)",
    pilar: "Métricas & BI",
    descricao:
      "Acompanhamento dos principais indicadores de contato, leads, funil, etapas do funil, desempenho por atendente, atividades da equipe e relatórios de vendas.",
    recursos: recursosPorModulo("dashboard"),
    rotas: [
      "/app/dashboard",
      "/app/analise",
      "/app/metrics",
      "/app/activities",
      "/app/ads/meta",
      "/app/ai/evolution",
      "/app/settings/metas",
      "/app/faturamento",
      "/app/honorarios",
    ],
  },
  connections: {
    id: "connections",
    nome: "Conexões (WhatsApp & Instagram)",
    pilar: "Canais de Comunicação",
    descricao:
      "Conexão multi-engine de números de WhatsApp (Uaizap, WAHA, Evolution API, Meta Cloud API Oficial), Instagram, automações visuais e webhooks.",
    recursos: recursosPorModulo("connections"),
    rotas: [
      "/app/connections",
      "/app/flows",
      "/app/webhooks",
      "/app/integrations/nuvemshop",
    ],
  },
};

/**
 * Lê os módulos liberados para a organização a partir de `organizations.settings`.
 * Padrão seguro: se não configurado, devolve todos os 7 módulos.
 */
export function modulosHabilitadosDaOrganizacao(settings: unknown): ModuloTenant[] {
  if (!settings || typeof settings !== "object") {
    return [...MODULOS_TENANT_TODOS];
  }
  const s = settings as Record<string, unknown>;
  const lista = s.modulos_habilitados;
  if (!Array.isArray(lista)) {
    return [...MODULOS_TENANT_TODOS];
  }
  return lista.filter((m): m is ModuloTenant =>
    MODULOS_TENANT_TODOS.includes(m as ModuloTenant),
  );
}

/**
 * Lê os recursos individuais liberados para a organização a partir de `organizations.settings`.
 *
 * Padrão seguro de retrocompatibilidade:
 * Se `recursos_habilitados` não estiver presente ou não for um array, TODOS os recursos
 * pertencentes aos módulos habilitados são considerados liberados.
 */
export function recursosHabilitadosDaOrganizacao(
  settings: unknown,
  modulosHabilitados?: readonly ModuloTenant[],
): string[] {
  const modulos = modulosHabilitados ?? modulosHabilitadosDaOrganizacao(settings);
  const modulosSet = new Set(modulos);

  if (!settings || typeof settings !== "object") {
    return Object.values(RECURSOS_TENANT_CATALOGO)
      .filter((r) => modulosSet.has(r.moduloId))
      .map((r) => r.id);
  }

  const s = settings as Record<string, unknown>;
  const lista = s.recursos_habilitados;

  if (!Array.isArray(lista)) {
    return Object.values(RECURSOS_TENANT_CATALOGO)
      .filter((r) => modulosSet.has(r.moduloId))
      .map((r) => r.id);
  }

  // Se explicitamente salvo, filtra apenas recursos que existem no catálogo e cujo módulo está habilitado
  const validos = new Set(
    lista.filter(
      (id): id is string =>
        typeof id === "string" &&
        id in RECURSOS_TENANT_CATALOGO &&
        modulosSet.has(RECURSOS_TENANT_CATALOGO[id]!.moduloId),
    ),
  );

  return [...validos];
}

/**
 * Identifica a qual módulo de negócio uma determinada rota ou destino pertence.
 * Devolve `null` caso seja uma porta essencial do sistema (ex: perfil, equipe, segurança, tags).
 */
export function moduloTenantDaRota(pathname: string): ModuloTenant | null {
  // Conhecimento tem precedência sobre AI geral
  if (pathname.startsWith("/app/ai/knowledge")) {
    return "knowledge_base";
  }
  // Evolução da IA mora em Análise/Dashboard
  if (pathname.startsWith("/app/ai/evolution")) {
    return "dashboard";
  }
  // Demais rotas de IA
  if (pathname.startsWith("/app/ai") || pathname.startsWith("/app/onboarding-ia")) {
    return "ai_agents";
  }
  if (pathname.startsWith("/app/inbox")) {
    return "inbox";
  }
  if (
    pathname.startsWith("/app/agenda") ||
    pathname.startsWith("/app/templates") ||
    pathname.startsWith("/app/radar") ||
    pathname === "/app/settings/tenant/agenda" ||
    pathname === "/app/settings/atendimento"
  ) {
    return "atendimento";
  }
  if (
    pathname.startsWith("/app/crm") ||
    pathname.startsWith("/app/kanban") ||
    pathname.startsWith("/app/contacts") ||
    pathname.startsWith("/app/tasks") ||
    pathname.startsWith("/app/deals") ||
    pathname.startsWith("/app/companies") ||
    pathname.startsWith("/app/people") ||
    pathname.startsWith("/app/products") ||
    pathname.startsWith("/app/proposals") ||
    pathname.startsWith("/app/prospecting") ||
    pathname.startsWith("/app/campaigns") ||
    pathname.startsWith("/app/comandas") ||
    pathname.startsWith("/app/imports") ||
    pathname.startsWith("/app/calls") ||
    pathname === "/app/settings/tenant/proposals" ||
    pathname.startsWith("/app/settings/tenant/proposals/") ||
    pathname === "/app/settings/tenant/pipelines" ||
    pathname === "/app/settings/tenant/financeiro"
  ) {
    return "crm";
  }
  if (
    pathname.startsWith("/app/dashboard") ||
    pathname.startsWith("/app/analise") ||
    pathname.startsWith("/app/metrics") ||
    pathname.startsWith("/app/activities") ||
    pathname.startsWith("/app/ads") ||
    pathname.startsWith("/app/faturamento") ||
    pathname.startsWith("/app/honorarios") ||
    pathname === "/app/settings/metas"
  ) {
    return "dashboard";
  }
  if (
    pathname.startsWith("/app/connections") ||
    pathname.startsWith("/app/flows") ||
    pathname.startsWith("/app/webhooks") ||
    pathname.startsWith("/app/integrations")
  ) {
    return "connections";
  }

  // Rotas essenciais (perfil, segurança, notificações, aplicativo, equipe, settings geral, tags, automacoes, recursos, audit)
  return null;
}

/**
 * Identifica a qual recurso específico de um módulo uma determinada rota pertence.
 * Devolve `null` caso seja rota essencial ou geral do módulo sem recurso restrito.
 */
export function recursoTenantDaRota(pathname: string): string | null {
  // Bases de Conhecimento
  if (pathname.startsWith("/app/ai/knowledge/sources")) return "kb_sources";
  if (pathname.startsWith("/app/ai/knowledge")) return "kb_documents";

  // Agentes de IA
  if (pathname.startsWith("/app/ai/followups")) return "ai_followups";
  if (pathname.startsWith("/app/ai/routers") || pathname.startsWith("/app/ai/atendimento")) return "ai_routers";
  if (pathname.startsWith("/app/ai/cases")) return "ai_cases";
  if (pathname.startsWith("/app/ai/memory") || pathname.startsWith("/app/ai/skills")) return "ai_skills_memory";
  if (
    pathname.startsWith("/app/ai/runs") ||
    pathname.startsWith("/app/ai/usage") ||
    pathname.startsWith("/app/ai/inbox")
  ) {
    return "ai_diagnostic";
  }
  if (
    pathname.startsWith("/app/ai/agents") ||
    pathname.startsWith("/app/ai/credentials") ||
    pathname.startsWith("/app/ai/providers") ||
    pathname.startsWith("/app/onboarding-ia") ||
    pathname === "/app/ai"
  ) {
    return "ai_agents_config";
  }

  // CRM
  if (
    pathname.startsWith("/app/proposals") ||
    pathname.startsWith("/app/settings/tenant/proposals")
  ) {
    return "crm_proposals";
  }
  if (pathname.startsWith("/app/products")) return "crm_products";
  if (pathname.startsWith("/app/tasks")) return "crm_tasks";
  if (
    pathname.startsWith("/app/contacts") ||
    pathname.startsWith("/app/companies") ||
    pathname.startsWith("/app/people") ||
    pathname.startsWith("/app/imports")
  ) {
    return "crm_contacts";
  }
  if (
    pathname.startsWith("/app/campaigns") ||
    pathname.startsWith("/app/prospecting") ||
    pathname.startsWith("/app/calls") ||
    pathname.startsWith("/app/comandas")
  ) {
    return "crm_campaigns";
  }
  if (
    pathname.startsWith("/app/kanban") ||
    pathname.startsWith("/app/deals") ||
    pathname.startsWith("/app/crm") ||
    pathname === "/app/settings/tenant/pipelines"
  ) {
    return "crm_kanban";
  }

  // Atendimento
  if (
    pathname.startsWith("/app/agenda") ||
    pathname === "/app/settings/tenant/agenda"
  ) {
    return "atendimento_agenda";
  }
  if (pathname.startsWith("/app/templates")) return "atendimento_templates";
  if (pathname.startsWith("/app/radar")) return "atendimento_radar";
  if (pathname === "/app/settings/atendimento") return "atendimento_distribuicao";

  // Dashboard / Análise
  if (pathname.startsWith("/app/activities")) return "dash_activities";
  if (pathname.startsWith("/app/ads")) return "dash_meta_ads";
  if (pathname.startsWith("/app/ai/evolution")) return "dash_ai_evolution";
  if (
    pathname.startsWith("/app/faturamento") ||
    pathname.startsWith("/app/honorarios") ||
    pathname === "/app/settings/metas"
  ) {
    return "dash_financial";
  }
  if (
    pathname.startsWith("/app/dashboard") ||
    pathname.startsWith("/app/analise") ||
    pathname.startsWith("/app/metrics")
  ) {
    return "dash_performance";
  }

  // Conexões
  if (pathname.startsWith("/app/flows")) return "conn_flows";
  if (pathname.startsWith("/app/webhooks")) return "conn_webhooks";
  if (pathname.startsWith("/app/integrations")) return "conn_ecommerce";
  if (pathname.startsWith("/app/connections")) return "conn_whatsapp";

  // Inbox
  if (pathname.startsWith("/app/inbox")) return "inbox_chat";

  return null;
}

/**
 * Verifica se a rota é permitida com base nos módulos e recursos liberados para a organização.
 */
export function rotaPermitidaPelosModulos(
  pathname: string,
  modulosHabilitados: readonly ModuloTenant[],
  recursosHabilitados?: readonly string[],
): boolean {
  const modulo = moduloTenantDaRota(pathname);
  if (!modulo) return true; // Rota essencial sempre liberada

  // 1. Módulo deve estar habilitado
  if (!modulosHabilitados.includes(modulo)) {
    return false;
  }

  // 2. Se recursos forem fornecidos, o recurso correspondente deve estar ativo
  if (recursosHabilitados && recursosHabilitados.length > 0) {
    const recurso = recursoTenantDaRota(pathname);
    if (recurso && !recursosHabilitados.includes(recurso)) {
      return false;
    }
  }

  return true;
}

/**
 * Ao ativar um recurso, resolve automaticamente todas as suas dependências em cadeia,
 * retornando os recursos e módulos que foram ativados como consequência.
 */
export function resolverDependenciasAoAtivar(
  recursoId: string,
  recursosAtuais: Set<string>,
  modulosAtuais: Set<ModuloTenant>,
): {
  recursosAdicionados: string[];
  modulosAdicionados: ModuloTenant[];
} {
  const recursosAdicionados: string[] = [];
  const modulosAdicionados: ModuloTenant[] = [];

  function ativar(id: string) {
    const info = RECURSOS_TENANT_CATALOGO[id];
    if (!info) return;

    if (!modulosAtuais.has(info.moduloId)) {
      modulosAtuais.add(info.moduloId);
      modulosAdicionados.push(info.moduloId);
    }

    if (!recursosAtuais.has(id)) {
      recursosAtuais.add(id);
      recursosAdicionados.push(id);
    }

    for (const depId of info.dependencias) {
      if (!recursosAtuais.has(depId)) {
        ativar(depId);
      }
    }
  }

  ativar(recursoId);

  return { recursosAdicionados, modulosAdicionados };
}

/**
 * Ao desativar um recurso, desativa automaticamente todos os recursos que dependem dele.
 */
export function resolverDependenciasAoDesativar(
  recursoId: string,
  recursosAtuais: Set<string>,
): {
  recursosRemovidos: string[];
} {
  const recursosRemovidos: string[] = [];

  function desativar(id: string) {
    if (recursosAtuais.has(id)) {
      recursosAtuais.delete(id);
      recursosRemovidos.push(id);
    }

    // Busca qualquer outro recurso que declare este id em suas dependências
    for (const outro of Object.values(RECURSOS_TENANT_CATALOGO)) {
      if (outro.dependencias.includes(id) && recursosAtuais.has(outro.id)) {
        desativar(outro.id);
      }
    }
  }

  desativar(recursoId);

  return { recursosRemovidos };
}
