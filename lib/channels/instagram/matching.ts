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
      // "contains" por palavra ou limite de palavra
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, "u");
      return re.test(t);
    });
}

export function findMatchingRule(
  rules: InstagramKeywordRule[],
  type: "comment_keyword" | "story_mention" | "dm_keyword",
  text: string,
): InstagramKeywordRule | null {
  const candidates = rules.filter((r) => r.active && r.type === type);

  if (type === "story_mention") {
    return candidates[0] ?? null;
  }

  for (const rule of candidates) {
    if (matchesKeywords(text, rule.keywords, rule.match)) {
      return rule;
    }
  }

  return null;
}
