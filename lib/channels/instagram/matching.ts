import type { InstagramKeywordRule } from "./types";

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
      const ruleType = r.type || (r as unknown as { trigger_type?: string }).trigger_type || "comment_keyword";
      if (ruleType !== type) return false;
      if (!isRuleWithinSchedule(r, now)) return false;

      // Se a regra exige um Post/Reels/Story específico, valida o media_id
      const ruleMediaId = r.media_id?.trim();
      if (ruleMediaId && ruleMediaId !== "all") {
        if (!targetMediaId || ruleMediaId !== targetMediaId) {
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
    const matchMode =
      rule.match || ((rule as unknown as { match_type?: "contains" | "exact" }).match_type ?? "contains");

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
