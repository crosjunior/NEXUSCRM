import type { FlowStartData, InstagramKeywordRule } from "./types";

/** Normaliza: minúsculas, sem acento, espaços colapsados */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesKeywords(
  text: string,
  keywords: string[],
  mode: "contains" | "exact",
): boolean {
  const t = normalizeText(text);
  if (!t) return false;

  return keywords
    .map(normalizeText)
    .filter(Boolean)
    .some((k) => {
      if (mode === "exact") return t === k;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, "u");
      return re.test(t);
    });
}

/** Verifica se a regra está dentro da janela de vigência (data/hora de início e fim) */
export function isRuleWithinSchedule(rule: InstagramKeywordRule, now = new Date()): boolean {
  if (rule.is_permanent !== false) return true;

  const nowMs = now.getTime();
  if (rule.starts_at) {
    const startMs = Date.parse(rule.starts_at);
    if (!Number.isNaN(startMs) && nowMs < startMs) {
      return false;
    }
  }
  if (rule.ends_at) {
    const endMs = Date.parse(rule.ends_at);
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return false;
    }
  }
  return true;
}

export function findMatchingRule(
  rules: InstagramKeywordRule[],
  type: "comment_keyword" | "story_mention" | "dm_keyword",
  text: string,
  opts?: { mediaId?: string; now?: Date },
): InstagramKeywordRule | null {
  const now = opts?.now ?? new Date();
  const targetMediaId = opts?.mediaId?.trim() || "";

  const candidates = rules
    .filter((r) => {
      if (!r.active) return false;
      if (!isRuleWithinSchedule(r, now)) return false;

      // Em modo visual, um fluxo pode ter múltiplos gatilhos no nó Início (ex: comment_keyword + dm_keyword)
      if (r.mode === "visual" && r.flow_graph?.nodes?.length) {
        const startNode = r.flow_graph.nodes.find((n) => n.type === "start");
        const startData = startNode?.data as FlowStartData | undefined;
        const matchedTrig = (startData?.triggers ?? []).some((trig) => {
          const mappedType =
            trig.type === "story_reply" || trig.type === "story_mention"
              ? "story_mention"
              : trig.type === "dm_keyword" || trig.type === "default_reply"
              ? "dm_keyword"
              : "comment_keyword";
          if (mappedType !== type) return false;
          const trigMedia = trig.mediaId?.trim() || r.media_id?.trim();
          if (trigMedia && trigMedia !== "all") {
            if (!targetMediaId || trigMedia !== targetMediaId) return false;
          }
          return true;
        });
        if (matchedTrig) return true;
      }

      const ruleType =
        r.type || (r as unknown as { trigger_type?: string }).trigger_type || "comment_keyword";
      const isStoryRule =
        ruleType === "story_mention" ||
        r.media_caption_preview?.startsWith("[STORY]") ||
        r.media_id?.includes("story");

      // Se o evento é de Story (menção ou resposta), aceita regras de story ou regras que tenham selecionado o story
      if (type === "story_mention") {
        if (!isStoryRule && ruleType !== "comment_keyword" && ruleType !== "dm_keyword") {
          return false;
        }
      } else if (type === "dm_keyword") {
        // Se o evento é DM e a regra é de DM ou story, ou regra de palavra-chave sem mídia exclusiva de feed
        if (ruleType !== "dm_keyword" && !isStoryRule && ruleType !== "comment_keyword") {
          return false;
        }
      } else if (ruleType !== type && !isStoryRule) {
        return false;
      }

      // Se a regra exige um Post/Reels/Story específico, valida o media_id
      const ruleMediaId = r.media_id?.trim();
      if (ruleMediaId && ruleMediaId !== "all") {
        // Se o evento trouxe o mediaId, exige que coincida. Se for story_mention e o evento não trouxe o ID, permite casar se a regra for de story.
        if (targetMediaId && ruleMediaId !== targetMediaId) {
          return false;
        }
      }
      return true;
    })
    // Prioriza regras de publicação específica antes de regras gerais ("qualquer publicação")
    .sort((a, b) => {
      const aSpecific = a.media_id && a.media_id !== "all" ? 1 : 0;
      const bSpecific = b.media_id && b.media_id !== "all" ? 1 : 0;
      return bSpecific - aSpecific;
    });

  for (const rule of candidates) {
    if (rule.mode === "visual" && rule.flow_graph?.nodes?.length) {
      const startNode = rule.flow_graph.nodes.find((n) => n.type === "start");
      const startData = startNode?.data as FlowStartData | undefined;
      for (const trig of startData?.triggers ?? []) {
        const mappedType =
          trig.type === "story_reply" || trig.type === "story_mention"
            ? "story_mention"
            : trig.type === "dm_keyword" || trig.type === "default_reply"
            ? "dm_keyword"
            : "comment_keyword";
        if (mappedType !== type) continue;
        if (trig.type === "default_reply" || trig.match === "any") return rule;
        if (type === "story_mention" && (!trig.keywords || trig.keywords.length === 0)) {
          return rule;
        }
        const mMode = trig.match === "exact" ? "exact" : "contains";
        if (matchesKeywords(text, trig.keywords ?? [], mMode)) {
          return rule;
        }
      }
    }

    const matchMode =
      rule.match ||
      ((rule as unknown as { match_type?: "contains" | "exact" }).match_type ?? "contains");

    // Em story_mention, se não houver palavras-chave definidas, dispara para qualquer menção/resposta no story
    if (type === "story_mention" && (!rule.keywords || rule.keywords.length === 0)) {
      return rule;
    }

    if (matchesKeywords(text, rule.keywords ?? [], matchMode)) {
      return rule;
    }
  }

  return null;
}
