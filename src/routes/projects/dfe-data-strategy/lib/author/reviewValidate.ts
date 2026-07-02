// reviewValidate.ts — server-side validation/clamping of the deep-review LLM output
// (author/review endpoint). Pure so it can be unit-tested; mirrors the /consider
// pattern: never trust the model's JSON shape, clamp every string, drop junk.

export interface ReviewSection {
  id: string;
  score: number; // 0–100
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export interface ReviewDocument {
  score: number;
  verdict: string;
  contradictions: string[];
  topFixes: string[];
  missingComponents: string[];
}

export interface ReviewResult {
  sections: ReviewSection[];
  document: ReviewDocument;
}

const strList = (x: unknown, max: number, len = 300): string[] =>
  (Array.isArray(x) ? x : [])
    .map((s) => String(typeof s === 'object' && s !== null ? ((s as any).point ?? (s as any).text ?? '') : (s ?? '')).trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

const clampScore = (x: unknown): number => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/** Validate the model's review JSON against the sections we actually sent. */
export function validateReview(parsed: unknown, validSectionIds: string[]): ReviewResult {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const valid = new Set(validSectionIds);
  const rawSections = Array.isArray(p.sections) ? (p.sections as unknown[]) : [];
  const seen = new Set<string>();
  const sections: ReviewSection[] = [];
  for (const raw of rawSections) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = String(r.id ?? '');
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    sections.push({
      id,
      score: clampScore(r.score),
      verdict: String(r.verdict ?? '').trim().slice(0, 240),
      strengths: strList(r.strengths, 4),
      weaknesses: strList(r.weaknesses, 4),
      suggestions: strList(r.suggestions, 5),
    });
  }
  const d = (p.document ?? {}) as Record<string, unknown>;
  return {
    sections,
    document: {
      score: clampScore(d.score),
      verdict: String(d.verdict ?? '').trim().slice(0, 400),
      contradictions: strList(d.contradictions, 6),
      topFixes: strList(d.topFixes, 3, 400),
      missingComponents: strList(d.missingComponents, 8, 120),
    },
  };
}
