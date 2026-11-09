import type {
  FlowActionData,
  FlowButtonItem,
  FlowConditionData,
  FlowDelayData,
  FlowAiData,
  FlowInputData,
  FlowMessageData,
  FlowNode,
  FlowNodeDataMap,
  FlowNodeType,
  FlowQuickReplyItem,
  FlowStartData,
  InstagramFlowGraph,
  InstagramKeywordRule,
} from "./types";

export const MAX_STEPS_PER_RUN = 25;

export interface FlowContactSnapshot {
  username?: string | null;
  name?: string | null;
  is_follower?: boolean | null;
  follower_count?: number | null;
  tags: string[];
  fields: Record<string, string | number | boolean | null>;
}

export interface FlowOutboundMessage {
  text?: string;
  imageUrl?: string;
  buttons?: FlowButtonItem[];
  quickReplies?: FlowQuickReplyItem[];
}

export type FlowEffect =
  | { type: "send"; nodeId: string; message: FlowOutboundMessage; viaCommentId?: string }
  | { type: "add_tag"; tag: string }
  | { type: "remove_tag"; tag: string }
  | { type: "set_field"; field: string; value: string }
  | { type: "handoff" }
  | { type: "webhook"; url: string; body: Record<string, unknown> }
  | { type: "schedule"; minutes: number; nodeId: string }
  | { type: "ai_reply"; nodeId: string; systemPrompt: string; userText?: string; viaCommentId?: string };

export type FlowSessionStatus =
  | "running"
  | "waiting_click"
  | "waiting_input"
  | "waiting_ai"
  | "waiting_any"
  | "scheduled"
  | "completed"
  | "expired";

export interface FlowEngineState {
  ruleId: string;
  nodeId: string | null;
  status: FlowSessionStatus;
  vars: Record<string, unknown>;
  privateReplyPending: boolean;
  steps: number;
  aiTurns?: number;
}

export interface FlowEntryContext {
  type: "comment" | "dm" | "story_mention" | "story_reply";
  commentId?: string;
  mediaId?: string;
  text?: string;
}

export type FlowEngineEvent =
  | { type: "start" }
  | { type: "postback"; nodeId: string; handleId: string }
  | { type: "text"; text: string }
  | { type: "resume" };

export interface FlowAdvanceOutput {
  state: FlowEngineState;
  effects: FlowEffect[];
  consumed: boolean;
}

export function uid(prefix = "n"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createFlowState(ruleId: string): FlowEngineState {
  return {
    ruleId,
    nodeId: null,
    status: "running",
    vars: {},
    privateReplyPending: false,
    steps: 0,
  };
}

export function getFlowNode(graph: InstagramFlowGraph, id: string | null): FlowNode | undefined {
  if (!id) return undefined;
  return graph.nodes.find((n) => n.id === id);
}

export function nextFlowTarget(
  graph: InstagramFlowGraph,
  nodeId: string,
  handle = "next",
): string | null {
  const edge = graph.edges.find(
    (e) => e.source === nodeId && (e.sourceHandle ?? "next") === handle,
  );
  return edge?.target ?? null;
}

export function startFlowTarget(graph: InstagramFlowGraph): string | null {
  const start = graph.nodes.find((n) => n.type === "start");
  return start ? nextFlowTarget(graph, start.id) : null;
}

// ---------------------------------------------------------------------
// Payload de postback: rf1|ruleId|nodeId|handleId
// ---------------------------------------------------------------------
export function encodeFlowPayload(ruleId: string, nodeId: string, handleId: string): string {
  return ["rf1", ruleId, nodeId, handleId].join("|");
}

export function decodeFlowPayload(
  payload: string | undefined | null,
): { ruleId: string; nodeId: string; handleId: string } | null {
  if (!payload) return null;
  const parts = payload.split("|");
  if (parts.length !== 4 || parts[0] !== "rf1") return null;
  const [, ruleId, nodeId, handleId] = parts;
  if (!ruleId || !nodeId || !handleId) return null;
  return { ruleId, nodeId, handleId };
}

// ---------------------------------------------------------------------
// Variáveis: {{username}}, {username}, {{name}}, {{first_name}}, {{field.email}}
// ---------------------------------------------------------------------
export function renderFlowTemplate(text: string, contact: FlowContactSnapshot): string {
  const cleanUser = (contact.username ?? "").replace(/^@/, "");
  const fullName = contact.name ?? cleanUser ?? "seguidor";
  const firstName = fullName.split(" ")[0] || cleanUser || "seguidor";

  return text
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      if (key === "username") return cleanUser ? `@${cleanUser}` : "";
      if (key === "name") return fullName;
      if (key === "first_name") return firstName;
      if (key.startsWith("field.")) {
        const v = contact.fields[key.slice(6)];
        return v == null ? "" : String(v);
      }
      return "";
    })
    .replace(/\{username\}/gi, cleanUser ? `@${cleanUser}` : "")
    .replace(/\{first_name\}/gi, firstName)
    .replace(/\{name\}/gi, fullName);
}

export function validateFlowInput(value: string, kind: FlowInputData["validation"]): boolean {
  const v = value.trim();
  if (!v) return false;
  switch (kind) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    case "phone":
      return v.replace(/\D/g, "").length >= 8;
    case "number":
      return !Number.isNaN(Number(v.replace(",", ".")));
    default:
      return true;
  }
}

export function evaluateFlowCondition(
  c: FlowConditionData,
  contact: FlowContactSnapshot,
): boolean {
  const field = c.field ? contact.fields[c.field] : undefined;
  switch (c.op) {
    case "is_follower":
      return contact.is_follower === true;
    case "not_follower":
      return contact.is_follower === false;
    case "has_tag":
      return !!c.tag && contact.tags.includes(c.tag);
    case "not_has_tag":
      return !c.tag || !contact.tags.includes(c.tag);
    case "field_exists":
      return field != null && String(field) !== "";
    case "field_equals":
      return String(field ?? "").toLowerCase() === String(c.value ?? "").toLowerCase();
    case "field_contains":
      return String(field ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
    default:
      return false;
  }
}

export function advanceFlow(
  graph: InstagramFlowGraph,
  prev: FlowEngineState,
  ctx: { contact: FlowContactSnapshot; entry: FlowEntryContext },
  event: FlowEngineEvent,
): FlowAdvanceOutput {
  const state: FlowEngineState = structuredClone(prev);
  state.steps = 0;
  const contact: FlowContactSnapshot = {
    ...ctx.contact,
    tags: [...ctx.contact.tags],
    fields: { ...ctx.contact.fields },
  };
  const effects: FlowEffect[] = [];

  const emit = (e: FlowEffect) => {
    effects.push(e);
    if (e.type === "add_tag" && !contact.tags.includes(e.tag)) contact.tags.push(e.tag);
    if (e.type === "remove_tag") contact.tags = contact.tags.filter((t) => t !== e.tag);
    if (e.type === "set_field") contact.fields[e.field] = e.value;
  };

  const done = (consumed = true): FlowAdvanceOutput => ({ state, effects, consumed });

  switch (event.type) {
    case "start": {
      state.nodeId = startFlowTarget(graph);
      state.status = "running";
      state.privateReplyPending = false;
      if (ctx.entry.text) state.vars.__lastText = ctx.entry.text;
      break;
    }

    case "postback": {
      state.privateReplyPending = false;
      let target = nextFlowTarget(graph, event.nodeId, event.handleId);
      if (!target && event.handleId === "skip") target = nextFlowTarget(graph, event.nodeId, "next");
      state.nodeId = target;
      state.status = "running";
      state.aiTurns = 0;
      break;
    }

    case "text": {
      state.privateReplyPending = false;
      state.vars.__lastText = event.text;
      const node = getFlowNode(graph, state.nodeId);

      if (state.status === "waiting_input" && node?.type === "input") {
        const data = node.data as FlowInputData;
        if (!validateFlowInput(event.text, data.validation)) {
          emit({
            type: "send",
            nodeId: node.id,
            message: {
              text: renderFlowTemplate(
                data.retryMessage || "Não entendi, pode tentar de novo?",
                contact,
              ),
              quickReplies: data.skipLabel ? [{ id: "skip", title: data.skipLabel }] : undefined,
            },
          });
          return done();
        }
        emit({ type: "set_field", field: data.field, value: event.text.trim() });
        state.nodeId = nextFlowTarget(graph, node.id);
        state.status = "running";
        break;
      }

      if (state.status === "waiting_ai" && node?.type === "ai") {
        const data = node.data as FlowAiData;
        emit({
          type: "ai_reply",
          nodeId: node.id,
          systemPrompt: data.systemPrompt,
          userText: event.text,
        });
        state.aiTurns = (state.aiTurns ?? 0) + 1;
        if (state.aiTurns >= Math.max(1, data.maxTurns)) {
          state.nodeId = nextFlowTarget(graph, node.id);
          state.status = "running";
          state.aiTurns = 0;
          break;
        }
        return done();
      }

      if (state.status === "waiting_click" && node?.type === "message") {
        const data = node.data as FlowMessageData;
        const t = event.text.trim().toLowerCase();
        const hit =
          (data.quickReplies ?? []).find((q) => q.title.trim().toLowerCase() === t) ??
          (data.buttons ?? []).find(
            (b) => b.type === "postback" && b.title.trim().toLowerCase() === t,
          );
        if (!hit) return done(false);
        state.nodeId = nextFlowTarget(graph, node.id, hit.id);
        state.status = "running";
        break;
      }

      if (state.status === "waiting_any") {
        state.status = "running";
        break;
      }

      return done(false);
    }

    case "resume": {
      if (state.status !== "scheduled" && state.status !== "waiting_any") return done(false);
      state.status = "running";
      break;
    }
  }

  while (state.status === "running") {
    if (!state.nodeId) {
      state.status = "completed";
      break;
    }
    if (++state.steps > MAX_STEPS_PER_RUN) {
      state.status = "completed";
      break;
    }
    const node = getFlowNode(graph, state.nodeId);
    if (!node) {
      state.nodeId = null;
      continue;
    }

    const sends = node.type === "message" || node.type === "input" || node.type === "ai";
    if (sends && state.privateReplyPending) {
      state.status = "waiting_any";
      break;
    }
    const viaCommentId =
      sends && ctx.entry.type === "comment" && ctx.entry.commentId && !state.vars.__prUsed
        ? ctx.entry.commentId
        : undefined;
    const markPrivateReply = () => {
      if (viaCommentId) {
        state.vars.__prUsed = true;
        state.privateReplyPending = true;
      }
    };

    switch (node.type) {
      case "start":
        state.nodeId = nextFlowTarget(graph, node.id);
        break;

      case "message": {
        const d = node.data as FlowMessageData;
        const buttons = (d.buttons ?? []).slice(0, 3);
        const quickReplies = (d.quickReplies ?? []).slice(0, 13);
        if (d.imageUrl && !viaCommentId) {
          emit({ type: "send", nodeId: node.id, message: { imageUrl: d.imageUrl } });
        }
        const text = renderFlowTemplate(d.text ?? "", contact);
        if (text || buttons.length || quickReplies.length) {
          emit({
            type: "send",
            nodeId: node.id,
            message: {
              text: text || " ",
              buttons: buttons.length ? buttons : undefined,
              quickReplies: quickReplies.length ? quickReplies : undefined,
            },
            viaCommentId,
          });
        }
        markPrivateReply();
        const waits = quickReplies.length > 0 || buttons.some((b) => b.type === "postback");
        if (waits) {
          state.status = "waiting_click";
        } else {
          state.nodeId = nextFlowTarget(graph, node.id);
        }
        break;
      }

      case "input": {
        const d = node.data as FlowInputData;
        emit({
          type: "send",
          nodeId: node.id,
          message: {
            text: renderFlowTemplate(d.question, contact),
            quickReplies: d.skipLabel ? [{ id: "skip", title: d.skipLabel }] : undefined,
          },
          viaCommentId,
        });
        markPrivateReply();
        state.status = "waiting_input";
        break;
      }

      case "condition": {
        const ok = evaluateFlowCondition(node.data as FlowConditionData, contact);
        state.nodeId = nextFlowTarget(graph, node.id, ok ? "true" : "false");
        break;
      }

      case "action": {
        const d = node.data as FlowActionData;
        for (const a of d.actions ?? []) {
          if (a.kind === "add_tag" && a.tag) emit({ type: "add_tag", tag: a.tag });
          if (a.kind === "remove_tag" && a.tag) emit({ type: "remove_tag", tag: a.tag });
          if (a.kind === "set_field" && a.field)
            emit({
              type: "set_field",
              field: a.field,
              value: renderFlowTemplate(a.value ?? "", contact),
            });
          if (a.kind === "handoff") emit({ type: "handoff" });
          if (a.kind === "webhook" && a.url)
            emit({
              type: "webhook",
              url: a.url,
              body: { ruleId: state.ruleId, nodeId: node.id, contact },
            });
        }
        state.nodeId = nextFlowTarget(graph, node.id);
        break;
      }

      case "delay": {
        const d = node.data as FlowDelayData;
        const target = nextFlowTarget(graph, node.id);
        if (!target) {
          state.nodeId = null;
          break;
        }
        const minutes = Math.max(1, Math.min(60 * 23, Math.round(d.minutes || 1)));
        emit({ type: "schedule", minutes, nodeId: target });
        state.nodeId = target;
        state.status = "scheduled";
        break;
      }

      case "ai": {
        const d = node.data as FlowAiData;
        emit({
          type: "ai_reply",
          nodeId: node.id,
          systemPrompt: d.systemPrompt,
          userText: typeof state.vars.__lastText === "string" ? state.vars.__lastText : undefined,
          viaCommentId,
        });
        markPrivateReply();
        if (d.conversational) {
          state.status = "waiting_ai";
          state.aiTurns = 0;
        } else {
          state.nodeId = nextFlowTarget(graph, node.id);
        }
        break;
      }
    }
  }

  return done();
}

// ---------------------------------------------------------------------
// Templates e Conversores entre Modo Básico e Modo Visual (ManyChat / NexusReply)
// ---------------------------------------------------------------------
export function defaultNodeData<T extends FlowNodeType>(type: T): FlowNodeDataMap[T] {
  const d: { [K in FlowNodeType]: FlowNodeDataMap[K] } = {
    start: { triggers: [] },
    message: { text: "", buttons: [], quickReplies: [] },
    input: {
      question: "Qual o seu melhor WhatsApp ou e-mail?",
      field: "email",
      validation: "email",
      retryMessage: "Hmm, esse dado não parece válido. Pode conferir?",
    },
    condition: { op: "is_follower", tag: "" },
    action: { actions: [] },
    delay: { minutes: 5 },
    ai: {
      systemPrompt:
        "Você é o assistente da marca. Responda em português, de forma breve e simpática. Se não souber, diga que um especialista vai responder.",
      conversational: false,
      maxTurns: 3,
    },
  };
  return structuredClone(d[type]);
}

export function makeFlowNode<T extends FlowNodeType>(
  type: T,
  position: { x: number; y: number },
  data?: Partial<FlowNodeDataMap[T]>,
): FlowNode<T> {
  return {
    id: uid(type.slice(0, 3)),
    type,
    position,
    data: { ...defaultNodeData(type), ...data } as FlowNode<T>["data"],
  };
}

/** Constrói o fluxo clássico ManyChat / NexusReply idêntico à tela de referência */
export function buildManyChatDefaultGraph(opts?: {
  keywords?: string[];
  publicReply?: string;
  dmMessage?: string;
  mediaId?: string | null;
}): InstagramFlowGraph {
  const kwList = opts?.keywords?.length ? opts.keywords : ["quero", "link"];
  const pubReplies = opts?.publicReply?.trim()
    ? [opts.publicReply.trim()]
    : ["Te enviei no direct! Dá uma olhada 🚀"];

  const start = makeFlowNode(
    "start",
    { x: 40, y: 120 },
    {
      triggers: [
        {
          id: uid("t"),
          type: "comment_keyword",
          keywords: kwList,
          match: "contains",
          mediaId: opts?.mediaId && opts.mediaId !== "all" ? opts.mediaId : null,
          publicReplies: pubReplies,
        },
        {
          id: uid("t"),
          type: "dm_keyword",
          keywords: kwList,
          match: "contains",
        },
      ],
    },
  );

  const btnId = uid("b");
  const m1 = makeFlowNode(
    "message",
    { x: 370, y: 120 },
    {
      text:
        opts?.dmMessage?.trim() ||
        "Oi {{first_name}}! 👋 Vi seu comentário. Toque no botão abaixo que eu te envio o link agora.",
      buttons: [{ id: btnId, title: "Quero o link", type: "postback" }],
      quickReplies: [],
    },
  );

  const m2 = makeFlowNode(
    "message",
    { x: 700, y: 210 },
    {
      text: "Aqui está! Qualquer dúvida é só responder por aqui.",
      buttons: [{ id: uid("b"), title: "Acessar", type: "url", url: "https://seusite.com.br" }],
      quickReplies: [],
    },
  );

  const tagNode = makeFlowNode(
    "action",
    { x: 1030, y: 150 },
    {
      actions: [{ id: uid("a"), kind: "add_tag", tag: "lead-comentario" }],
    },
  );

  return {
    nodes: [start, m1, m2, tagNode],
    edges: [
      { id: uid("e"), source: start.id, sourceHandle: "next", target: m1.id },
      { id: uid("e"), source: m1.id, sourceHandle: btnId, target: m2.id },
      { id: uid("e"), source: m2.id, sourceHandle: "next", target: tagNode.id },
    ],
  };
}

/** Sincroniza os campos principais da regra a partir de um grafo visual */
export function extractRuleSummaryFromGraph(graph: InstagramFlowGraph): {
  type: InstagramKeywordRule["type"];
  keywords: string[];
  match: "contains" | "exact";
  public_reply: string | null;
  dm_message: string;
  media_id: string | null;
} {
  const startNode = graph.nodes.find((n) => n.type === "start");
  const startData = (startNode?.data as FlowStartData | undefined) ?? { triggers: [] };
  const primaryTrigger = startData.triggers[0];

  const type: InstagramKeywordRule["type"] =
    primaryTrigger?.type === "story_mention" || primaryTrigger?.type === "story_reply"
      ? "story_mention"
      : primaryTrigger?.type === "dm_keyword"
      ? "dm_keyword"
      : "comment_keyword";

  const allKeywords = Array.from(
    new Set(startData.triggers.flatMap((t) => t.keywords ?? []).filter(Boolean)),
  );
  const match: "contains" | "exact" = primaryTrigger?.match === "exact" ? "exact" : "contains";
  const publicReply =
    startData.triggers.find((t) => t.type === "comment_keyword")?.publicReplies?.[0] ?? null;
  const mediaId =
    startData.triggers.find((t) => t.type === "comment_keyword")?.mediaId ?? null;

  const firstTargetId = startNode ? nextFlowTarget(graph, startNode.id) : null;
  const firstMsgNode =
    (firstTargetId ? graph.nodes.find((n) => n.id === firstTargetId) : undefined) ??
    graph.nodes.find((n) => n.type === "message");

  const dmMessage =
    (firstMsgNode?.data as FlowMessageData | undefined)?.text?.trim() ||
    "Fluxo visual configurado";

  return {
    type,
    keywords: allKeywords.length > 0 ? allKeywords : ["quero"],
    match,
    public_reply: publicReply,
    dm_message: dmMessage,
    media_id: mediaId || null,
  };
}

export interface FlowValidationIssue {
  nodeId?: string;
  level: "error" | "warning";
  message: string;
}

export function validateFlowGraph(graph: InstagramFlowGraph): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) {
    issues.push({ level: "error", message: "O fluxo precisa de exatamente um nó Início." });
  }
  const start = starts[0];
  if (start) {
    const d = start.data as FlowStartData;
    if (!d.triggers?.length) {
      issues.push({
        nodeId: start.id,
        level: "error",
        message: "Adicione ao menos um gatilho no nó Início.",
      });
    }
    if (!graph.edges.some((e) => e.source === start.id)) {
      issues.push({
        nodeId: start.id,
        level: "error",
        message: "Conecte o nó Início ao primeiro passo.",
      });
    }
  }

  for (const n of graph.nodes) {
    if (n.type === "message") {
      const m = n.data as FlowMessageData;
      if (!m.text?.trim() && !m.imageUrl) {
        issues.push({ nodeId: n.id, level: "error", message: "Mensagem sem texto ou imagem." });
      }
      for (const b of m.buttons ?? []) {
        if (!b.title.trim()) {
          issues.push({ nodeId: n.id, level: "error", message: "Botão sem título." });
        }
        if (b.type === "url" && !/^https?:\/\//i.test(b.url ?? "")) {
          issues.push({
            nodeId: n.id,
            level: "warning",
            message: `Botão "${b.title || "URL"}" precisa de link https://`,
          });
        }
      }
    }
  }

  return issues;
}
