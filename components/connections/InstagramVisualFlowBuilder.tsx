"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play,
  MessageSquare,
  HelpCircle,
  GitBranch,
  Zap,
  Clock,
  Sparkles,
  ExternalLink,
  Plus,
  Trash2,
  FlaskConical,
  AlertTriangle,
  RotateCcw,
  Send,
  X,
  Maximize2,
  Minimize2,
  Bot,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import {
  advanceFlow,
  createFlowState,
  makeFlowNode,
  uid,
  validateFlowGraph,
  type FlowContactSnapshot,
  type FlowEffect,
  type FlowEngineEvent,
  type FlowEngineState,
  type FlowEntryContext,
} from "@/lib/channels/instagram/flow-engine";
import { matchesKeywords } from "@/lib/channels/instagram/matching";
import type {
  FlowActionData,
  FlowActionItem,
  FlowAiData,
  FlowButtonItem,
  FlowConditionData,
  FlowConditionOp,
  FlowDelayData,
  FlowInputData,
  FlowMessageData,
  FlowNode,
  FlowNodeType,
  FlowQuickReplyItem,
  FlowStartData,
  FlowTriggerConfig,
  InstagramFlowGraph,
  InstagramMediaItem,
} from "@/lib/channels/instagram/types";

interface InstagramVisualFlowBuilderProps {
  graph: InstagramFlowGraph;
  onChange: (next: InstagramFlowGraph) => void;
  mediaItems: InstagramMediaItem[];
  availableAgents?: Array<{ id: string; name: string; is_default?: boolean }>;
  availableKnowledgeSources?: Array<{ id: string; title: string }>;
}

const NODE_WIDTH = 280;

const PALETTE: {
  type: Exclude<FlowNodeType, "start">;
  label: string;
  icon: typeof MessageSquare;
  badgeColor: string;
  dotColor: string;
}[] = [
  {
    type: "message",
    label: "Mensagem",
    icon: MessageSquare,
    badgeColor: "bg-indigo-600 text-white",
    dotColor: "#4f46e5",
  },
  {
    type: "input",
    label: "Pergunta",
    icon: HelpCircle,
    badgeColor: "bg-sky-500 text-white",
    dotColor: "#0ea5e9",
  },
  {
    type: "condition",
    label: "Condição",
    icon: GitBranch,
    badgeColor: "bg-amber-500 text-white",
    dotColor: "#f59e0b",
  },
  {
    type: "action",
    label: "Ação",
    icon: Zap,
    badgeColor: "bg-pink-500 text-white",
    dotColor: "#ec4899",
  },
  {
    type: "delay",
    label: "Espera",
    icon: Clock,
    badgeColor: "bg-zinc-600 text-white",
    dotColor: "#52525b",
  },
  {
    type: "ai",
    label: "IA",
    icon: Sparkles,
    badgeColor: "bg-violet-600 text-white",
    dotColor: "#7c3aed",
  },
];

const TRIGGER_LABELS: Record<FlowTriggerConfig["type"], string> = {
  comment_keyword: "Comentário com palavra-chave",
  dm_keyword: "DM com palavra-chave",
  story_reply: "Resposta ao Story",
  story_mention: "Menção no Story",
  default_reply: "Qualquer mensagem (padrão)",
};

const ACTION_LABELS: Record<FlowActionItem["kind"], string> = {
  add_tag: "Adicionar tag",
  remove_tag: "Remover tag",
  set_field: "Definir campo",
  handoff: "Transferir para humano",
  webhook: "Chamar webhook",
};

const COND_LABELS: Record<FlowConditionOp, string> = {
  is_follower: "é seguidor do perfil",
  not_follower: "NÃO é seguidor do perfil",
  has_tag: "tem a tag",
  not_has_tag: "não tem a tag",
  field_equals: "campo igual a",
  field_contains: "campo contém",
  field_exists: "campo preenchido",
};

interface OutputHandleInfo {
  id: string;
  label: string;
  offsetY: number;
  tone?: "emerald" | "indigo" | "amber" | "red" | "default";
}

/** Calcula os pontos de saída de um nó para desenhar as conexões (smoothstep) */
function getNodeOutputHandles(node: FlowNode): OutputHandleInfo[] {
  if (node.type === "start") {
    const d = node.data as FlowStartData;
    const trigsCount = Math.max(1, d.triggers?.length ?? 0);
    const baseY = 58 + trigsCount * 54 + 18;
    return [{ id: "next", label: "Começar", offsetY: baseY, tone: "emerald" }];
  }

  if (node.type === "message") {
    const d = node.data as FlowMessageData;
    const handles: OutputHandleInfo[] = [];
    const postbackButtons = (d.buttons ?? []).filter((b) => b.type === "postback");
    const urlButtons = (d.buttons ?? []).filter((b) => b.type === "url");
    const quickReplies = d.quickReplies ?? [];

    let currentY = 128 + urlButtons.length * 36;
    for (const b of postbackButtons) {
      handles.push({
        id: b.id,
        label: b.title || "(botão sem título)",
        offsetY: currentY,
        tone: "indigo",
      });
      currentY += 36;
    }
    for (const q of quickReplies) {
      handles.push({
        id: q.id,
        label: `⚡ ${q.title || "(resposta rápida)"}`,
        offsetY: currentY,
        tone: "indigo",
      });
      currentY += 36;
    }
    if (handles.length === 0) {
      handles.push({
        id: "next",
        label: "Próximo passo",
        offsetY: currentY,
        tone: "default",
      });
    }
    return handles;
  }

  if (node.type === "input") {
    const d = node.data as FlowInputData;
    const handles: OutputHandleInfo[] = [
      { id: "next", label: "Resposta válida", offsetY: 138, tone: "emerald" },
    ];
    if (d.skipLabel) {
      handles.push({
        id: "skip",
        label: `Pular (${d.skipLabel})`,
        offsetY: 174,
        tone: "default",
      });
    }
    return handles;
  }

  if (node.type === "condition") {
    return [
      { id: "true", label: "✓ Sim", offsetY: 112, tone: "emerald" },
      { id: "false", label: "✕ Não", offsetY: 148, tone: "red" },
    ];
  }

  if (node.type === "action") {
    const d = node.data as FlowActionData;
    const actionsCount = Math.max(1, d.actions?.length ?? 0);
    return [
      {
        id: "next",
        label: "Próximo passo",
        offsetY: 64 + actionsCount * 22 + 24,
        tone: "default",
      },
    ];
  }

  return [{ id: "next", label: "Próximo passo", offsetY: 112, tone: "default" }];
}

function buildSmoothStepPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = x1 + (x2 - x1) * 0.5;
  if (x2 >= x1 - 10) {
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }
  const offset = 36;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} L ${x1 + offset} ${y1} L ${x1 + offset} ${midY} L ${x2 - offset} ${midY} L ${x2 - offset} ${y2} L ${x2} ${y2}`;
}

export function InstagramVisualFlowBuilder({
  graph,
  onChange,
  mediaItems,
  availableAgents = [],
  availableKnowledgeSources = [],
}: InstagramVisualFlowBuilderProps) {
  const t = useT();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    graph.nodes[0]?.id ?? null,
  );
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    handleId: string;
  } | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const issues = validateFlowGraph(graph);
  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  function addNode(type: Exclude<FlowNodeType, "start">) {
    const index = graph.nodes.length;
    const newNode = makeFlowNode(type, {
      x: 120 + (index % 3) * 330,
      y: 90 + Math.floor(index / 3) * 210,
    });
    const nextGraph: InstagramFlowGraph = {
      ...graph,
      nodes: [...graph.nodes, newNode],
    };
    onChange(nextGraph);
    setSelectedNodeId(newNode.id);
  }

  function updateNodeData(nodeId: string, nextData: FlowNode["data"]) {
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: nextData } : n)),
    });
  }

  function deleteNode(nodeId: string) {
    const target = graph.nodes.find((n) => n.id === nodeId);
    if (!target || target.type === "start") return;
    onChange({
      nodes: graph.nodes.filter((n) => n.id !== nodeId),
      edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(graph.nodes[0]?.id ?? null);
    }
  }

  function connectHandleToTarget(sourceId: string, sourceHandle: string, targetId: string) {
    if (sourceId === targetId) return;
    const filtered = graph.edges.filter(
      (e) => !(e.source === sourceId && (e.sourceHandle ?? "next") === sourceHandle),
    );
    if (!targetId) {
      onChange({ ...graph, edges: filtered });
      return;
    }
    onChange({
      ...graph,
      edges: [
        ...filtered,
        { id: uid("e"), source: sourceId, sourceHandle, target: targetId },
      ],
    });
  }

  function handleNodeMouseDown(e: React.MouseEvent, node: FlowNode) {
    if ((e.target as HTMLElement).closest("[data-no-drag='true']")) return;
    e.stopPropagation();
    setSelectedNodeId(node.id);
    draggingRef.current = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
    };
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = draggingRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const nextX = Math.max(16, Math.round((drag.origX + dx) / 10) * 10);
      const nextY = Math.max(16, Math.round((drag.origY + dy) / 10) * 10);

      onChange({
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === drag.nodeId ? { ...n, position: { x: nextX, y: nextY } } : n,
        ),
      });
    }

    function onMouseUp() {
      draggingRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [graph, onChange]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-900 shadow-sm dark:border-zinc-800">
      {/* Barra Superior de Ferramentas (idêntica ao ReplyFlow / ManyChat) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {PALETTE.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => addNode(p.type)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-50/60"
              >
                <span className={`inline-flex rounded-md p-1 ${p.badgeColor}`}>
                  <Icon className="h-3 w-3" />
                </span>
                {p.type === "message"
                  ? t("Mensagem")
                  : p.type === "input"
                    ? t("Pergunta")
                    : p.type === "condition"
                      ? t("Condição")
                      : p.type === "action"
                        ? t("Ação")
                        : p.type === "delay"
                          ? t("Espera")
                          : t("IA")}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {issues.length > 0 && (
            <button
              type="button"
              onClick={() => setShowIssues((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              {issues.length} {issues.length === 1 ? t("aviso") : t("avisos")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSimulator((s) => !s)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              showSimulator
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {t("Testar Fluxo")}
          </button>
        </div>
      </div>

      {/* Lista de avisos se clicada */}
      {showIssues && issues.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-xs">
          <div className="flex items-center justify-between pb-1 font-semibold text-amber-900">
            <span>{t("Verificações do fluxo")}</span>
            <button
              type="button"
              onClick={() => setShowIssues(false)}
              className="text-amber-700 hover:underline"
            >
              {t("Fechar")}
            </button>
          </div>
          <ul className="space-y-1">
            {issues.map((iss, idx) => (
              <li
                key={idx}
                onClick={() => iss.nodeId && setSelectedNodeId(iss.nodeId)}
                className="cursor-pointer text-amber-800 hover:underline"
              >
                • {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Aviso de conexão ativa */}
      {connectingFrom && (
        <div className="flex items-center justify-between bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white">
          <span>
            {t("🔗 Clique em qualquer bloco no quadro para conectar a saída selecionada, ou escolha pelo painel lateral.")}
          </span>
          <button
            type="button"
            onClick={() => setConnectingFrom(null)}
            className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] hover:bg-white/30"
          >
            {t("Cancelar conexão")}
          </button>
        </div>
      )}

      {/* Área Principal: Canvas + Editor Lateral / Simulador */}
      <div className="grid grid-cols-1 lg:grid-cols-12" style={{ minHeight: 540 }}>
        {/* Canvas Visual Pontilhado */}
        <div
          ref={canvasRef}
          onClick={() => {
            if (connectingFrom) setConnectingFrom(null);
          }}
          className="relative col-span-1 overflow-auto lg:col-span-8"
          style={{
            minHeight: 540,
            backgroundImage: "radial-gradient(#d4d4d8 1.25px, transparent 1.25px)",
            backgroundSize: "18px 18px",
            backgroundColor: "#fafafa",
          }}
        >
          <div className="relative" style={{ width: 1380, height: 640 }}>
            {/* Camada SVG de Linhas Conectoras (SmoothStep + Pontos Roxos) */}
            <svg
              className="pointer-events-none absolute inset-0"
              width={1380}
              height={640}
              style={{ overflow: "visible" }}
            >
              {graph.edges.map((edge) => {
                const sourceNode = graph.nodes.find((n) => n.id === edge.source);
                const targetNode = graph.nodes.find((n) => n.id === edge.target);
                if (!sourceNode || !targetNode) return null;

                const handles = getNodeOutputHandles(sourceNode);
                const handleInfo =
                  handles.find((h) => h.id === (edge.sourceHandle ?? "next")) ?? handles[0];
                const startX = sourceNode.position.x + NODE_WIDTH;
                const startY = sourceNode.position.y + (handleInfo?.offsetY ?? 110);
                const endX = targetNode.position.x;
                const endY = targetNode.position.y + 82;

                const pathD = buildSmoothStepPath(startX, startY, endX, endY);

                return (
                  <g key={edge.id}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#a1a1aa"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                    />
                    {/* Seta na chegada do card alvo */}
                    <polygon
                      points={`${endX},${endY} ${endX - 6},${endY - 4} ${endX - 6},${endY + 4}`}
                      fill="#a1a1aa"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Renderização dos Cards de Nós */}
            {graph.nodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const handles = getNodeOutputHandles(node);

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (connectingFrom && connectingFrom.nodeId !== node.id) {
                      connectHandleToTarget(
                        connectingFrom.nodeId,
                        connectingFrom.handleId,
                        node.id,
                      );
                      setConnectingFrom(null);
                      return;
                    }
                    setSelectedNodeId(node.id);
                  }}
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    width: NODE_WIDTH,
                  }}
                  className={`absolute select-none rounded-2xl border bg-white shadow-sm transition-shadow cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-md"
                      : connectingFrom && connectingFrom.nodeId !== node.id
                      ? "border-emerald-400 ring-2 ring-emerald-400/30"
                      : "border-zinc-200/90 hover:border-zinc-300"
                  }`}
                >
                  {/* Ponto de entrada (Target Handle) para todos os nós exceto start */}
                  {node.type !== "start" && (
                    <span
                      title={t("Entrada do passo")}
                      style={{ top: 82 }}
                      className="absolute -left-1.5 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-400 shadow-xs"
                    />
                  )}

                  {/* Conteúdo específico de cada tipo de nó */}
                  <NodeCardBody
                    node={node}
                    handles={handles}
                    edges={graph.edges}
                    allNodes={graph.nodes}
                    connectingFrom={connectingFrom}
                    onStartConnect={(handleId) =>
                      setConnectingFrom({ nodeId: node.id, handleId })
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Painel Direito: Editor do Nó Selecionado OU Simulador Interativo */}
        <div className="col-span-1 border-t border-zinc-200 bg-white lg:col-span-4 lg:border-t-0 lg:border-l">
          {showSimulator ? (
            <VisualFlowSimulator
              graph={graph}
              onClose={() => setShowSimulator(false)}
            />
          ) : selectedNode ? (
            <VisualNodeSideEditor
              node={selectedNode}
              allNodes={graph.nodes}
              edges={graph.edges}
              mediaItems={mediaItems}
              onChangeData={(d) => updateNodeData(selectedNode.id, d)}
              onConnectHandle={(handleId, targetId) =>
                connectHandleToTarget(selectedNode.id, handleId, targetId)
              }
              onDelete={() => deleteNode(selectedNode.id)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-zinc-500">
              {t("Clique em qualquer bloco no quadro ao lado para editar suas configurações e conexões.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Card Visual de cada Nó no Canvas (fiel ao ReplyFlow / ManyChat)
// ---------------------------------------------------------------------
function NodeCardBody({
  node,
  handles,
  edges,
  allNodes,
  connectingFrom,
  onStartConnect,
}: {
  node: FlowNode;
  handles: OutputHandleInfo[];
  edges: InstagramFlowGraph["edges"];
  allNodes: FlowNode[];
  connectingFrom: { nodeId: string; handleId: string } | null;
  onStartConnect: (handleId: string) => void;
}) {
  const t = useT();
  const headerConfig: Record<
    FlowNodeType,
    { title: string; icon: typeof Play; badge: string }
  > = {
    start: { title: "Início", icon: Play, badge: "bg-emerald-500 text-white" },
    message: { title: "Mensagem", icon: MessageSquare, badge: "bg-indigo-600 text-white" },
    input: { title: "Pergunta", icon: HelpCircle, badge: "bg-sky-500 text-white" },
    condition: { title: "Condição", icon: GitBranch, badge: "bg-amber-500 text-white" },
    action: { title: "Ação", icon: Zap, badge: "bg-pink-500 text-white" },
    delay: { title: "Espera", icon: Clock, badge: "bg-zinc-600 text-white" },
    ai: { title: "IA", icon: Sparkles, badge: "bg-violet-600 text-white" },
  };

  const hdr = headerConfig[node.type];
  const Icon = hdr.icon;

  return (
    <div>
      {/* Cabeçalho do Bloco */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3.5 py-2.5">
        <span className={`inline-flex rounded-lg p-1.5 ${hdr.badge}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-semibold text-zinc-800">{hdr.title}</span>
      </div>

      {/* Corpo do Bloco */}
      <div className="space-y-2 p-3.5 text-xs text-zinc-600">
        {node.type === "start" && (
          <div className="space-y-1.5">
            {((node.data as FlowStartData).triggers ?? []).length === 0 ? (
              <p className="text-zinc-400">{t("Clique para configurar o gatilho")}</p>
            ) : (
              ((node.data as FlowStartData).triggers ?? []).map((trig) => (
                <div
                  key={trig.id}
                  className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900"
                >
                  <div className="font-semibold">{t(TRIGGER_LABELS[trig.type])}</div>
                  {trig.keywords?.length > 0 && (
                    <div className="truncate text-emerald-700">{trig.keywords.join(", ")}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {node.type === "message" && (
          <div className="space-y-1.5">
            {(node.data as FlowMessageData).imageUrl && (
              <div className="truncate rounded-md bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500">
                🖼️ {(node.data as FlowMessageData).imageUrl}
              </div>
            )}
            <p className="line-clamp-3 whitespace-pre-wrap text-zinc-700">
              {(node.data as FlowMessageData).text || (
                <span className="text-zinc-400">{t("Mensagem vazia…")}</span>
              )}
            </p>
            {((node.data as FlowMessageData).buttons ?? [])
              .filter((b) => b.type === "url")
              .map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600"
                >
                  <span className="truncate">{b.title || t("(sem título)")}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
                </div>
              ))}
          </div>
        )}

        {node.type === "input" && (
          <div className="space-y-1">
            <p className="line-clamp-2 text-zinc-700">
              {(node.data as FlowInputData).question || t("Pergunta…")}
            </p>
            <div className="text-[11px] text-zinc-400">
              {t("Salvar em")}{" "}
              <code className="rounded-md bg-zinc-100 px-1 text-zinc-700">
                {(node.data as FlowInputData).field || "?"}
              </code>{" "}
              ({(node.data as FlowInputData).validation})
            </div>
          </div>
        )}

        {node.type === "condition" && (
          <div className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            {t("Se contato")}{" "}
            <b>{t(COND_LABELS[(node.data as FlowConditionData).op])}</b>{" "}
            <code className="font-mono">
              {(node.data as FlowConditionData).op === "is_follower" ||
              (node.data as FlowConditionData).op === "not_follower"
                ? ""
                : (node.data as FlowConditionData).op.includes("tag")
                ? (node.data as FlowConditionData).tag || "?"
                : `${(node.data as FlowConditionData).field || "?"} ${
                    (node.data as FlowConditionData).value ?? ""
                  }`}
            </code>
          </div>
        )}

        {node.type === "action" && (
          <div className="space-y-1">
            {((node.data as FlowActionData).actions ?? []).length === 0 ? (
              <p className="text-zinc-400">{t("Nenhuma ação configurada")}</p>
            ) : (
              ((node.data as FlowActionData).actions ?? []).map((a) => (
                <div key={a.id} className="truncate text-[11px] text-zinc-700">
                  • {t(ACTION_LABELS[a.kind])}{" "}
                  <span className="font-medium text-zinc-900">
                    {a.tag ?? a.field ?? a.url ?? ""}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {node.type === "delay" && (
          <p className="text-zinc-700">
            {t("Aguardar")} <b>{(node.data as FlowDelayData).minutes} min</b>
          </p>
        )}

        {node.type === "ai" && (
          <div className="space-y-1">
            <p className="line-clamp-2 text-zinc-700">
              {(node.data as FlowAiData).systemPrompt || t("Instruções da IA…")}
            </p>
            <div className="text-[11px] text-violet-700">
              {(node.data as FlowAiData).conversational
                ? `${t("Conversa até")} ${(node.data as FlowAiData).maxTurns} ${t("turnos")}`
                : t("Resposta única")}
            </div>
          </div>
        )}

        {/* Linhas de Saída (Handles com bolinha roxa/verde à direita) */}
        <div className="space-y-1.5 pt-1">
          {handles.map((h) => {
            const connectedEdge = edges.find(
              (e) => e.source === node.id && (e.sourceHandle ?? "next") === h.id,
            );
            const targetNode = connectedEdge
              ? allNodes.find((n) => n.id === connectedEdge.target)
              : null;
            const isConnectingThis =
              connectingFrom?.nodeId === node.id && connectingFrom?.handleId === h.id;

            const boxClasses =
              h.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                : h.tone === "indigo"
                ? "border-indigo-200 bg-indigo-50/70 text-indigo-800 font-medium"
                : h.tone === "red"
                ? "border-red-200 bg-red-50/70 text-red-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-600";

            return (
              <div
                key={h.id}
                data-no-drag="true"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartConnect(h.id);
                }}
                title={t("Clique para conectar a outro passo")}
                className={`relative flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] cursor-pointer transition hover:brightness-95 ${boxClasses} ${
                  isConnectingThis ? "ring-2 ring-indigo-500" : ""
                }`}
              >
                <span className="truncate">{h.label}</span>
                {targetNode && (
                  <span className="ml-1 truncate text-[10px] opacity-65">
                    → {headerConfig[targetNode.type].title}
                  </span>
                )}
                <span
                  className={`-mr-5 h-3 w-3 shrink-0 rounded-full border-2 border-white shadow-xs ${
                    h.tone === "emerald"
                      ? "bg-emerald-500"
                      : h.tone === "red"
                      ? "bg-red-500"
                      : "bg-indigo-600"
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Painel Lateral de Edição do Nó Selecionado
// ---------------------------------------------------------------------
function VisualNodeSideEditor({
  node,
  allNodes,
  edges,
  mediaItems,
  onChangeData,
  onConnectHandle,
  onDelete,
}: {
  node: FlowNode;
  allNodes: FlowNode[];
  edges: InstagramFlowGraph["edges"];
  mediaItems: InstagramMediaItem[];
  onChangeData: (data: FlowNode["data"]) => void;
  onConnectHandle: (handleId: string, targetId: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const titles: Record<FlowNodeType, string> = {
    start: "Gatilhos de entrada (Início)",
    message: "Enviar mensagem",
    input: "Perguntar e salvar resposta",
    condition: "Condição ( Seguidor / Tag / Campo )",
    action: "Executar ações",
    delay: "Aguardar tempo",
    ai: "Resposta com IA",
  };

  const handles = getNodeOutputHandles(node);
  const availableTargets = allNodes.filter((n) => n.id !== node.id && n.type !== "start");

  return (
    <div className="flex h-full max-h-[640px] flex-col overflow-y-auto p-4 text-xs text-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
        <h4 className="text-sm font-semibold text-zinc-900">{titles[node.type]}</h4>
        {node.type !== "start" && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("Excluir passo")}
          </button>
        )}
      </div>

      <div className="mt-4 flex-1 space-y-4">
        {node.type === "start" && (
          <StartNodeForm
            data={node.data as FlowStartData}
            mediaItems={mediaItems}
            onChange={onChangeData}
          />
        )}
        {node.type === "message" && (
          <MessageNodeForm
            data={node.data as FlowMessageData}
            onChange={onChangeData}
          />
        )}
        {node.type === "input" && (
          <InputNodeForm
            data={node.data as FlowInputData}
            onChange={onChangeData}
          />
        )}
        {node.type === "condition" && (
          <ConditionNodeForm
            data={node.data as FlowConditionData}
            onChange={onChangeData}
          />
        )}
        {node.type === "action" && (
          <ActionNodeForm
            data={node.data as FlowActionData}
            onChange={onChangeData}
          />
        )}
        {node.type === "delay" && (
          <DelayNodeForm
            data={node.data as FlowDelayData}
            onChange={onChangeData}
          />
        )}
        {node.type === "ai" && (
          <AiNodeForm
            data={node.data as FlowAiData}
            onChange={onChangeData}
            availableAgents={availableAgents}
            availableKnowledgeSources={availableKnowledgeSources}
          />
        )}

        {/* Seletor de Conexões de Saída (Próximo Passo) */}
        <div className="space-y-2 border-t border-zinc-200 pt-4">
          <Label className="text-xs font-semibold text-zinc-700">
            {t("🔗 Conexões de saída deste bloco")}
          </Label>
          {handles.map((h) => {
            const currentEdge = edges.find(
              (e) => e.source === node.id && (e.sourceHandle ?? "next") === h.id,
            );
            return (
              <div key={h.id} className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                <span className="block text-[11px] font-medium text-zinc-600">
                  {t("Saída:")} <b>{h.label}</b>
                </span>
                <select
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800"
                  value={currentEdge?.target ?? ""}
                  onChange={(e) => onConnectHandle(h.id, e.target.value)}
                >
                  <option value="">{t("— Fim do fluxo (desconectado) —")}</option>
                  {availableTargets.map((tNode) => {
                    const preview =
                      tNode.type === "message"
                        ? (tNode.data as FlowMessageData).text?.slice(0, 28) || "Mensagem"
                        : tNode.type === "action"
                        ? "Ação (Tag/Handoff/Webhook)"
                        : tNode.type === "condition"
                        ? "Condição"
                        : tNode.type === "input"
                        ? "Pergunta"
                        : tNode.type === "delay"
                        ? "Espera"
                        : "IA";
                    return (
                      <option key={tNode.id} value={tNode.id}>
                        [{tNode.type.toUpperCase()}] {preview}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sub-formulários de cada Tipo de Nó
// ---------------------------------------------------------------------
function StartNodeForm({
  data,
  mediaItems,
  onChange,
}: {
  data: FlowStartData;
  mediaItems: InstagramMediaItem[];
  onChange: (d: FlowStartData) => void;
}) {
  const t = useT();
  const updateTrig = (idx: number, patch: Partial<FlowTriggerConfig>) => {
    onChange({
      triggers: data.triggers.map((trig, i) => (i === idx ? { ...trig, ...patch } : trig)),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        {t("O fluxo dispara quando qualquer um dos gatilhos abaixo acontecer no Instagram.")}
      </p>
      {data.triggers.map((trig, idx) => (
        <div
          key={trig.id}
          className="space-y-2.5 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <select
              className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-900"
              value={trig.type}
              onChange={(e) =>
                updateTrig(idx, { type: e.target.value as FlowTriggerConfig["type"] })
              }
            >
              <option value="comment_keyword">{t("Comentário em Post/Reels")}</option>
              <option value="dm_keyword">{t("Mensagem no Direct (DM)")}</option>
              <option value="story_reply">{t("Resposta ao Story")}</option>
              <option value="story_mention">{t("Menção em Story (@sua_conta)")}</option>
              <option value="default_reply">{t("Qualquer DM (resposta padrão)")}</option>
            </select>
            {data.triggers.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ triggers: data.triggers.filter((_, j) => j !== idx) })
                }
                className="text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {(trig.type === "comment_keyword" ||
            trig.type === "dm_keyword" ||
            trig.type === "story_reply") && (
            <>
              <div>
                <Label className="text-[11px] text-zinc-600">{t("Correspondência")}</Label>
                <select
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
                  value={trig.match}
                  onChange={(e) =>
                    updateTrig(idx, {
                      match: e.target.value as FlowTriggerConfig["match"],
                    })
                  }
                >
                  <option value="contains">{t("Contém a palavra")}</option>
                  <option value="exact">{t("Igual à palavra")}</option>
                  <option value="any">{t("Qualquer texto")}</option>
                </select>
              </div>

              {trig.match !== "any" && (
                <div>
                  <Label className="text-[11px] text-zinc-600">
                    {t("Palavras-chave (separadas por vírgula)")}
                  </Label>
                  <Input
                    className="mt-1 h-8 bg-white text-xs text-zinc-900"
                    value={trig.keywords.join(", ")}
                    onChange={(e) =>
                      updateTrig(idx, {
                        keywords: e.target.value.split(",").map((s) => s.trim()),
                      })
                    }
                    placeholder={t("quero, link, eu quero")}
                  />
                </div>
              )}
            </>
          )}

          {trig.type === "comment_keyword" && (
            <>
              <div>
                <Label className="text-[11px] text-zinc-600">
                  {t("Publicação alvo (Post ou Reels)")}
                </Label>
                <select
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
                  value={trig.mediaId ?? ""}
                  onChange={(e) => updateTrig(idx, { mediaId: e.target.value || null })}
                >
                  <option value="">{t("Qualquer post ou reel da conta")}</option>
                  {mediaItems.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.media_product_type}] {m.caption_preview}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-[11px] text-zinc-600">
                  {t("Respostas públicas no comentário (1 por linha — sorteia)")}
                </Label>
                <Textarea
                  rows={2}
                  className="mt-1 bg-white text-xs text-zinc-900"
                  value={(trig.publicReplies ?? []).join("\n")}
                  onChange={(e) =>
                    updateTrig(idx, { publicReplies: e.target.value.split("\n") })
                  }
                  placeholder={t("Te mandei no direct! 📩\nOlha sua DM 😉")}
                />
              </div>
            </>
          )}
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full text-xs"
        onClick={() =>
          onChange({
            triggers: [
              ...data.triggers,
              {
                id: uid("t"),
                type: "comment_keyword",
                keywords: ["quero"],
                match: "contains",
                publicReplies: ["Te enviei no direct! 🚀"],
              },
            ],
          })
        }
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> {t("Adicionar gatilho")}
      </Button>
    </div>
  );
}

function MessageNodeForm({
  data,
  onChange,
}: {
  data: FlowMessageData;
  onChange: (d: FlowMessageData) => void;
}) {
  const t = useT();
  const updBtn = (idx: number, patch: Partial<FlowButtonItem>) =>
    onChange({
      ...data,
      buttons: data.buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });

  const updQr = (idx: number, patch: Partial<FlowQuickReplyItem>) =>
    onChange({
      ...data,
      quickReplies: data.quickReplies.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    });

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px] text-zinc-600">{t("Texto da mensagem")}</Label>
        <Textarea
          rows={4}
          className="mt-1 bg-white text-xs text-zinc-900"
          value={data.text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          placeholder={t("Oi {{first_name}}! 👋 Toque no botão abaixo...")}
        />
        <p className="mt-1 text-[10px] text-zinc-400">
          {t("Variáveis:")} <code>{"{{first_name}}"}</code>, <code>{"{{username}}"}</code>,{" "}
          <code>{"{{field.email}}"}</code>
        </p>
      </div>

      <div>
        <Label className="text-[11px] text-zinc-600">{t("URL de imagem (opcional, https://)")}</Label>
        <Input
          className="mt-1 h-8 bg-white text-xs text-zinc-900"
          value={data.imageUrl ?? ""}
          onChange={(e) => onChange({ ...data, imageUrl: e.target.value || undefined })}
          placeholder="https://…"
        />
      </div>

      {/* Botões (até 3) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-semibold text-zinc-700">
            {t("Botões")} ({data.buttons.length}/3)
          </Label>
          {data.buttons.length < 3 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...data,
                  buttons: [
                    ...data.buttons,
                    { id: uid("b"), title: "Quero o link", type: "postback" },
                  ],
                })
              }
              className="text-[11px] font-medium text-indigo-600 hover:underline"
            >
              {t("+ Botão")}
            </button>
          )}
        </div>

        {data.buttons.map((b, i) => (
          <div key={b.id} className="space-y-1.5 rounded-lg border border-zinc-200 p-2">
            <div className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 bg-white text-xs text-zinc-900"
                maxLength={20}
                value={b.title}
                onChange={(e) => updBtn(i, { title: e.target.value })}
                placeholder={t("Título (máx 20)")}
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...data,
                    buttons: data.buttons.filter((_, j) => j !== i),
                  })
                }
                className="text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <select
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px]"
              value={b.type}
              onChange={(e) => updBtn(i, { type: e.target.value as "postback" | "url" })}
            >
              <option value="postback">{t("Continuar fluxo (conecta ao próximo passo)")}</option>
              <option value="url">{t("Abrir link externo (URL)")}</option>
            </select>
            {b.type === "url" && (
              <Input
                className="h-7 bg-white text-xs text-zinc-900"
                value={b.url ?? ""}
                onChange={(e) => updBtn(i, { url: e.target.value })}
                placeholder="https://x.example.com"
              />
            )}
          </div>
        ))}
      </div>

      {/* Respostas rápidas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-semibold text-zinc-700">
            {t("Respostas rápidas")} ({data.quickReplies.length}/13)
          </Label>
          {data.quickReplies.length < 13 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...data,
                  quickReplies: [
                    ...data.quickReplies,
                    { id: uid("q"), title: "Sim, quero!" },
                  ],
                })
              }
              className="text-[11px] font-medium text-indigo-600 hover:underline"
            >
              {t("+ Resposta rápida")}
            </button>
          )}
        </div>
        {data.quickReplies.map((q, i) => (
          <div key={q.id} className="flex items-center gap-1.5">
            <Input
              className="h-7 flex-1 bg-white text-xs text-zinc-900"
              maxLength={20}
              value={q.title}
              onChange={(e) => updQr(i, { title: e.target.value })}
              placeholder={t("Texto da pílula")}
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...data,
                  quickReplies: data.quickReplies.filter((_, j) => j !== i),
                })
              }
              className="text-zinc-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InputNodeForm({
  data,
  onChange,
}: {
  data: FlowInputData;
  onChange: (d: FlowInputData) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px] text-zinc-600">{t("Pergunta enviada ao usuário")}</Label>
        <Textarea
          rows={3}
          className="mt-1 bg-white text-xs text-zinc-900"
          value={data.question}
          onChange={(e) => onChange({ ...data, question: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px] text-zinc-600">{t("Salvar no campo")}</Label>
          <Input
            className="mt-1 h-8 bg-white text-xs text-zinc-900"
            value={data.field}
            onChange={(e) =>
              onChange({ ...data, field: e.target.value.replace(/\W/g, "") })
            }
            placeholder="email"
          />
        </div>
        <div>
          <Label className="text-[11px] text-zinc-600">{t("Validação")}</Label>
          <select
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
            value={data.validation}
            onChange={(e) =>
              onChange({
                ...data,
                validation: e.target.value as FlowInputData["validation"],
              })
            }
          >
            <option value="text">{t("Texto livre")}</option>
            <option value="email">{t("E-mail")}</option>
            <option value="phone">{t("Telefone / WhatsApp")}</option>
            <option value="number">{t("Número")}</option>
          </select>
        </div>
      </div>
      <div>
        <Label className="text-[11px] text-zinc-600">{t("Mensagem se resposta for inválida")}</Label>
        <Input
          className="mt-1 h-8 bg-white text-xs text-zinc-900"
          value={data.retryMessage}
          onChange={(e) => onChange({ ...data, retryMessage: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-[11px] text-zinc-600">{t("Botão Pular (opcional)")}</Label>
        <Input
          className="mt-1 h-8 bg-white text-xs text-zinc-900"
          value={data.skipLabel ?? ""}
          onChange={(e) => onChange({ ...data, skipLabel: e.target.value || undefined })}
          placeholder={t("Deixe vazio para não mostrar")}
        />
      </div>
    </div>
  );
}

function ConditionNodeForm({
  data,
  onChange,
}: {
  data: FlowConditionData;
  onChange: (d: FlowConditionData) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px] text-zinc-600">{t("Regra da condição")}</Label>
        <select
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
          value={data.op}
          onChange={(e) => onChange({ ...data, op: e.target.value as FlowConditionOp })}
        >
          <option value="is_follower">{t("Contato É seguidor do perfil")}</option>
          <option value="not_follower">{t("Contato NÃO é seguidor do perfil")}</option>
          <option value="has_tag">{t("Contato tem a tag")}</option>
          <option value="not_has_tag">{t("Contato NÃO tem a tag")}</option>
          <option value="field_exists">{t("Campo está preenchido")}</option>
          <option value="field_equals">{t("Campo é igual a")}</option>
          <option value="field_contains">{t("Campo contém")}</option>
        </select>
      </div>

      {(data.op === "has_tag" || data.op === "not_has_tag") && (
        <div>
          <Label className="text-[11px] text-zinc-600">{t("Tag")}</Label>
          <Input
            className="mt-1 h-8 bg-white text-xs text-zinc-900"
            value={data.tag ?? ""}
            onChange={(e) => onChange({ ...data, tag: e.target.value.trim() })}
            placeholder="lead-quente"
          />
        </div>
      )}

      {(data.op === "field_exists" ||
        data.op === "field_equals" ||
        data.op === "field_contains") && (
        <>
          <div>
            <Label className="text-[11px] text-zinc-600">{t("Campo")}</Label>
            <Input
              className="mt-1 h-8 bg-white text-xs text-zinc-900"
              value={data.field ?? ""}
              onChange={(e) => onChange({ ...data, field: e.target.value })}
              placeholder="email"
            />
          </div>
          {data.op !== "field_exists" && (
            <div>
              <Label className="text-[11px] text-zinc-600">{t("Valor")}</Label>
              <Input
                className="mt-1 h-8 bg-white text-xs text-zinc-900"
                value={data.value ?? ""}
                onChange={(e) => onChange({ ...data, value: e.target.value })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionNodeForm({
  data,
  onChange,
}: {
  data: FlowActionData;
  onChange: (d: FlowActionData) => void;
}) {
  const t = useT();
  const upd = (idx: number, patch: Partial<FlowActionItem>) =>
    onChange({
      actions: data.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    });

  return (
    <div className="space-y-2.5">
      {data.actions.map((a, i) => (
        <div key={a.id} className="space-y-2 rounded-lg border border-zinc-200 p-2">
          <div className="flex items-center gap-2">
            <select
              className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs"
              value={a.kind}
              onChange={(e) => upd(i, { kind: e.target.value as FlowActionItem["kind"] })}
            >
              <option value="add_tag">{t("Adicionar tag")}</option>
              <option value="remove_tag">{t("Remover tag")}</option>
              <option value="set_field">{t("Definir campo")}</option>
              <option value="handoff">{t("Transferir para humano")}</option>
              <option value="webhook">{t("Enviar webhook (n8n, Make, CRM)")}</option>
            </select>
            <button
              type="button"
              onClick={() =>
                onChange({ actions: data.actions.filter((_, j) => j !== i) })
              }
              className="text-zinc-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {(a.kind === "add_tag" || a.kind === "remove_tag") && (
            <Input
              className="h-7 bg-white text-xs text-zinc-900"
              value={a.tag ?? ""}
              onChange={(e) =>
                upd(i, { tag: e.target.value.trim().toLowerCase() })
              }
              placeholder="lead-comentario"
            />
          )}

          {a.kind === "set_field" && (
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                className="h-7 bg-white text-xs text-zinc-900"
                value={a.field ?? ""}
                onChange={(e) => upd(i, { field: e.target.value })}
                placeholder="campo"
              />
              <Input
                className="h-7 bg-white text-xs text-zinc-900"
                value={a.value ?? ""}
                onChange={(e) => upd(i, { value: e.target.value })}
                placeholder="valor"
              />
            </div>
          )}

          {a.kind === "webhook" && (
            <Input
              className="h-7 bg-white text-xs text-zinc-900"
              value={a.url ?? ""}
              onChange={(e) => upd(i, { url: e.target.value })}
              placeholder="https://hooks..."
            />
          )}
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full text-xs"
        onClick={() =>
          onChange({
            actions: [
              ...data.actions,
              { id: uid("a"), kind: "add_tag", tag: "lead-comentario" },
            ],
          })
        }
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> {t("Adicionar ação")}
      </Button>
    </div>
  );
}

function DelayNodeForm({
  data,
  onChange,
}: {
  data: FlowDelayData;
  onChange: (d: FlowDelayData) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label className="text-[11px] text-zinc-600">{t("Minutos de espera")}</Label>
      <Input
        type="number"
        min={1}
        max={1380}
        className="h-8 bg-white text-xs text-zinc-900"
        value={data.minutes}
        onChange={(e) => onChange({ minutes: Number(e.target.value) })}
      />
      <p className="text-[10px] text-zinc-400">
        {t("Máximo de 23h — respeitando a janela de 24h da Meta.")}
      </p>
    </div>
  );
}

function AiNodeForm({
  data,
  onChange,
  availableAgents = [],
  availableKnowledgeSources = [],
}: {
  data: FlowAiData;
  onChange: (d: FlowAiData) => void;
  availableAgents?: Array<{ id: string; name: string; is_default?: boolean }>;
  availableKnowledgeSources?: Array<{ id: string; title: string }>;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);

  // Manipulador de paste que garante preservação absoluta da formatação original (quebras de linha, tabs, múltiplos espaços)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    
    // Insere mantendo quebras de linha normais
    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const val = target.value;
    const nextVal = val.substring(0, start) + text + val.substring(end);
    onChange({ ...data, systemPrompt: nextVal });
    
    // Atualiza a posição do cursor após colagem
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = start + text.length;
    });
    e.preventDefault();
  };

  return (
    <div className="space-y-3">
      {/* Seletor de Agente de IA da Empresa */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Bot className="h-3.5 w-3.5 text-violet-600" />
          <Label className="text-[11px] font-medium text-zinc-700">
            {t("Agente de IA Responsável")}
          </Label>
        </div>
        <select
          className="w-full rounded-md border border-zinc-300 bg-white p-1.5 text-xs text-zinc-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          value={data.agentId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            onChange({ ...data, agentId: val ? val : null });
          }}
        >
          <option value="">{t("Instruções personalizadas deste nó")}</option>
          {availableAgents.map((ag) => (
            <option key={ag.id} value={ag.id}>
              {ag.name} {ag.is_default ? `(${t("Padrão da Empresa")})` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-zinc-500">
          {availableAgents.length > 1
            ? t("Esta empresa possui múltiplos agentes. Escolha qual irá conduzir as respostas deste bloco.")
            : t("Selecione um agente ou use instruções personalizadas abaixo.")}
        </p>
      </div>

      {/* Instruções e Conhecimento da IA com botão de expandir */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-[11px] font-medium text-zinc-700">
            {t("Instruções e conhecimento da IA")}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(true)}
            className="h-6 px-1.5 text-[11px] text-violet-700 hover:bg-violet-50 hover:text-violet-800 gap-1"
            title={t("Expandir editor para melhor visualização")}
          >
            <Maximize2 className="h-3 w-3" />
            <span>{t("Expandir")}</span>
          </Button>
        </div>
        <Textarea
          rows={5}
          className="mt-1 bg-white text-xs text-zinc-900 font-mono whitespace-pre-wrap leading-relaxed border-zinc-300 focus:border-violet-500 focus:ring-violet-500"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", tabSize: 2 }}
          value={data.systemPrompt}
          onPaste={handlePaste}
          onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
          placeholder={t("Cole aqui as instruções, regras de atendimento, tom de voz, preços e links...")}
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
          <span>{t("Formatação original e quebras de linha preservadas ao colar")}</span>
          <span>{data.systemPrompt?.length || 0} {t("caracteres")}</span>
        </div>
      </div>

      {/* Base de Conhecimento vinculada */}
      {availableKnowledgeSources.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <BookOpen className="h-3.5 w-3.5 text-blue-600" />
            <Label className="text-[11px] font-medium text-zinc-700">
              {t("Bases de Conhecimento vinculadas")}
            </Label>
          </div>
          <div className="max-h-28 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-1.5 space-y-1">
            {availableKnowledgeSources.map((kb) => {
              const isChecked = (data.knowledgeSourceIds || []).includes(kb.id);
              return (
                <label
                  key={kb.id}
                  className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer hover:bg-white p-1 rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      const current = data.knowledgeSourceIds || [];
                      const next = e.target.checked
                        ? [...current, kb.id]
                        : current.filter((id) => id !== kb.id);
                      onChange({ ...data, knowledgeSourceIds: next });
                    }}
                    className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500 h-3.5 w-3.5"
                  />
                  <span className="truncate">{kb.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Modo Conversa */}
      <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={data.conversational}
          onChange={(e) => onChange({ ...data, conversational: e.target.checked })}
          className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500 h-3.5 w-3.5"
        />
        {t("Modo conversa (responde várias mensagens seguidas)")}
      </label>
      {data.conversational && (
        <div>
          <Label className="text-[11px] text-zinc-600">{t("Máximo de turnos antes de seguir")}</Label>
          <Input
            type="number"
            min={1}
            max={20}
            className="mt-1 h-8 bg-white text-xs text-zinc-900 border-zinc-300"
            value={data.maxTurns}
            onChange={(e) => onChange({ ...data, maxTurns: Number(e.target.value) })}
          />
        </div>
      )}

      {/* MODAL EXPANDIDO DE EDIÇÃO DO PROMPT DA IA */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative flex flex-col h-[85vh] w-full max-w-4xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl text-zinc-100">
            {/* Header do Modal */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-950/60 border border-violet-800/40 text-violet-400">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {t("Editor Expandido de Instruções do Agente de IA")}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {t("Formatação, quebras de linha e tabulações mantidas exatamente como coladas.")}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(false)}
                className="h-8 w-8 p-0 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Corpo do Editor */}
            <div className="flex-1 py-4 flex flex-col">
              <Textarea
                autoFocus
                className="flex-1 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 font-mono text-xs text-zinc-100 leading-relaxed focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", tabSize: 2 }}
                value={data.systemPrompt}
                onPaste={handlePaste}
                onChange={(e) => onChange({ ...data, systemPrompt: e.target.value })}
                placeholder={t("Cole ou digite aqui as instruções completas do seu agente de IA...")}
              />
            </div>

            {/* Rodapé do Modal */}
            <div className="flex items-center justify-between pt-4 border-t border-zinc-800 text-xs text-zinc-400">
              <div className="flex items-center gap-4">
                <span>{data.systemPrompt?.length || 0} {t("caracteres")}</span>
                <span>{(data.systemPrompt?.split("\n").length) || 0} {t("linhas")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsExpanded(false)}
                  className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                >
                  <Minimize2 className="h-3.5 w-3.5 mr-1" />
                  {t("Concluir Edição")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Simulador Interativo do Fluxo Visual (Idêntico ao NexusReply Simulator)
// ---------------------------------------------------------------------
type SimBubble =
  | { kind: "user"; text: string }
  | {
      kind: "bot";
      nodeId: string;
      text?: string;
      imageUrl?: string;
      buttons?: { id: string; title: string; type: string; url?: string }[];
      quick?: { id: string; title: string }[];
      viaComment?: boolean;
    }
  | { kind: "note"; text: string };

function VisualFlowSimulator({
  graph,
  onClose,
}: {
  graph: InstagramFlowGraph;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"comment" | "dm">("comment");
  const [simIsFollower, setSimIsFollower] = useState(true);
  const [bubbles, setBubbles] = useState<SimBubble[]>([]);
  const [text, setText] = useState("");
  const stateRef = useRef<FlowEngineState | null>(null);
  const entryRef = useRef<FlowEntryContext>({ type: "comment" });
  const contactRef = useRef<FlowContactSnapshot>({
    tags: [],
    fields: {},
    username: "cliente.teste",
    name: "Cliente Teste",
    is_follower: true,
  });

  function reset() {
    stateRef.current = null;
    contactRef.current = {
      tags: [],
      fields: {},
      username: "cliente.teste",
      name: "Cliente Teste",
      is_follower: simIsFollower,
    };
    setBubbles([]);
  }

  function applyEffects(effects: FlowEffect[], out: SimBubble[]) {
    for (const e of effects) {
      if (e.type === "send") {
        out.push({
          kind: "bot",
          nodeId: e.nodeId,
          text: e.message.text,
          imageUrl: e.message.imageUrl,
          buttons: e.message.buttons,
          quick: e.message.quickReplies,
          viaComment: Boolean(e.viaCommentId),
        });
      } else if (e.type === "add_tag") {
        contactRef.current.tags = [...new Set([...contactRef.current.tags, e.tag])];
        out.push({ kind: "note", text: `🏷️ Tag adicionada: ${e.tag}` });
      } else if (e.type === "remove_tag") {
        contactRef.current.tags = contactRef.current.tags.filter((t) => t !== e.tag);
        out.push({ kind: "note", text: `🏷️ Tag removida: ${e.tag}` });
      } else if (e.type === "set_field") {
        contactRef.current.fields = { ...contactRef.current.fields, [e.field]: e.value };
        out.push({ kind: "note", text: `📝 ${e.field} = ${String(e.value)}` });
      } else if (e.type === "handoff") {
        out.push({ kind: "note", text: "🙋 Conversa transferida para humano" });
      } else if (e.type === "webhook") {
        out.push({ kind: "note", text: `🔗 Webhook POST ${e.url}` });
      } else if (e.type === "schedule") {
        out.push({ kind: "note", text: `⏱️ Aguardaria ${e.minutes} min (pulado no teste)` });
      } else if (e.type === "ai_reply") {
        out.push({
          kind: "bot",
          nodeId: e.nodeId,
          text: "🤖 [Resposta gerada pela IA aparece aqui]",
          viaComment: Boolean(e.viaCommentId),
        });
      }
    }
  }

  function runEvent(event: FlowEngineEvent, out: SimBubble[]): boolean {
    contactRef.current.is_follower = simIsFollower;
    const st = event.type === "start" ? createFlowState("sim") : stateRef.current;
    if (!st) return false;
    let r = advanceFlow(
      graph,
      st,
      { contact: contactRef.current, entry: entryRef.current },
      event,
    );
    if (!r.consumed) return false;
    applyEffects(r.effects, out);

    let guard = 0;
    while (r.state.status === "scheduled" && guard++ < 10) {
      r = advanceFlow(
        graph,
        r.state,
        { contact: contactRef.current, entry: entryRef.current },
        { type: "resume" },
      );
      applyEffects(r.effects, out);
    }
    stateRef.current = r.state;
    if (r.state.status === "completed") {
      out.push({ kind: "note", text: "✓ Fluxo concluído" });
    }
    return true;
  }

  function getTriggers(): FlowTriggerConfig[] {
    const start = graph.nodes.find((n) => n.type === "start");
    return (start?.data as FlowStartData | undefined)?.triggers ?? [];
  }

  function handleSend() {
    const t = text.trim();
    if (!t) return;
    setText("");
    const out: SimBubble[] = [
      { kind: "user", text: mode === "comment" ? `💬 Comentou: "${t}"` : t },
    ];

    if (mode === "comment") {
      const trig = getTriggers().find(
        (x) =>
          x.type === "comment_keyword" &&
          (x.match === "any" || matchesKeywords(t, x.keywords, x.match)),
      );
      if (!trig) {
        out.push({
          kind: "note",
          text: "Nenhum gatilho de comentário casou com essa palavra.",
        });
      } else {
        if (trig.publicReplies?.filter(Boolean).length) {
          out.push({
            kind: "note",
            text: `↩️ Resposta pública no post: "${trig.publicReplies[0]}"`,
          });
        }
        entryRef.current = { type: "comment", commentId: "sim_comment", text: t };
        runEvent({ type: "start" }, out);
        setMode("dm");
      }
      setBubbles((b) => [...b, ...out]);
      return;
    }

    const handled =
      stateRef.current &&
      !["completed", "expired"].includes(stateRef.current.status) &&
      runEvent({ type: "text", text: t }, out);

    if (!handled) {
      const kw = getTriggers().find(
        (x) =>
          x.type === "dm_keyword" &&
          (x.match === "any" || matchesKeywords(t, x.keywords, x.match)),
      );
      const def = getTriggers().find((x) => x.type === "default_reply");
      if (kw || def) {
        entryRef.current = { type: "dm", text: t };
        runEvent({ type: "start" }, out);
      } else {
        out.push({
          kind: "note",
          text: "Nenhum gatilho de DM casou — em produção nada seria enviado.",
        });
      }
    }
    setBubbles((b) => [...b, ...out]);
  }

  function handleButtonClick(nodeId: string, handleId: string, title: string) {
    const out: SimBubble[] = [{ kind: "user", text: title }];
    if (!stateRef.current) stateRef.current = createFlowState("sim");
    runEvent({ type: "postback", nodeId, handleId }, out);
    setBubbles((b) => [...b, ...out]);
  }

  return (
    <div className="flex h-full max-h-[640px] flex-col bg-white text-xs">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5">
        <span className="font-semibold text-zinc-900">{t("Simulador do Fluxo")}</span>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
          {t("Teste")}
        </Badge>
        <button
          type="button"
          onClick={reset}
          title={t("Recomeçar")}
          className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("Fechar simulador")}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Seletor se o contato simulado é seguidor ou não */}
      <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px]">
        <span className="text-zinc-600">{t("Perfil simulado:")}</span>
        <button
          type="button"
          onClick={() => setSimIsFollower((f) => !f)}
          className={`rounded-full px-2 py-0.5 font-medium ${
            simIsFollower
              ? "bg-emerald-100 text-emerald-800"
              : "bg-zinc-200 text-zinc-700"
          }`}
        >
          {simIsFollower ? t("✓ É Seguidor") : t("Não é seguidor")}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-zinc-50/70 p-3">
        {bubbles.length === 0 && (
          <p className="mt-6 text-center text-xs text-zinc-400">
            {t("Digite a palavra-chave (ex:")} <b>quero</b>{t(") abaixo para testar o disparo e clicar nos botões como o seguidor verá no Direct.")}
          </p>
        )}
        {bubbles.map((b, i) =>
          b.kind === "note" ? (
            <p key={i} className="text-center text-[11px] text-zinc-500">
              {b.text}
            </p>
          ) : b.kind === "user" ? (
            <div
              key={i}
              className="ml-auto max-w-[82%] rounded-2xl rounded-br-xs bg-indigo-600 px-3 py-2 text-xs text-white"
            >
              {b.text}
            </div>
          ) : (
            <div key={i} className="max-w-[88%] space-y-1">
              {b.viaComment && (
                <div className="text-[10px] text-zinc-400">{t("Private Reply ao comentário")}</div>
              )}
              {b.text && (
                <div className="whitespace-pre-wrap rounded-2xl rounded-bl-xs border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 shadow-2xs">
                  {b.text}
                </div>
              )}
              {b.buttons?.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => {
                    if (btn.type === "url" && btn.url) {
                      window.open(btn.url, "_blank", "noopener,noreferrer");
                    } else {
                      handleButtonClick(b.nodeId, btn.id, btn.title);
                    }
                  }}
                  className="block w-full rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-center text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  {btn.title} {btn.type === "url" && "↗"}
                </button>
              ))}
              {b.quick && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {b.quick.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => handleButtonClick(b.nodeId, q.id, q.title)}
                      className="rounded-full border border-indigo-300 bg-white px-2.5 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50"
                    >
                      {q.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-200 p-2.5">
        <div className="flex gap-1">
          {(["comment", "dm"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                mode === m
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {m === "comment" ? t("💬 Comentário no Post") : t("📩 Mensagem (DM)")}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            className="h-8 flex-1 bg-white text-xs text-zinc-900"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              mode === "comment" ? t("Ex: quero") : t("Digite uma mensagem na DM...")
            }
          />
          <Button type="button" size="sm" className="h-8 px-2.5" onClick={handleSend}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
