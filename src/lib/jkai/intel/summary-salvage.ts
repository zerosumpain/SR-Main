// Getting the summaries out of a reply that stopped half way through.
//
// The batched summary writer asks one model call to describe 25 entities and
// then `JSON.parse`s the lot. When the reply is truncated — which it was,
// nightly, because the token budget had no headroom — the parse throws and all
// 25 summaries are discarded, including the twenty that arrived complete and
// correct before the cut.
//
// Reproduced against the production model and budget: two runs in three came
// back `finish_reason: length` at exactly the cap, with the same "Unterminated
// string in JSON" the production logs show. Raising the budget is the fix for
// the cause; this is the fix for the consequence, because a long batch can
// always overrun and losing the whole batch when nineteen twentieths of it is
// good is a waste of a call that has already been paid for.
//
// PURE — no DB, no clock, no model. Exhaustively tested.

export interface SalvagedSummary {
  id: string;
  summary: string;
}

/**
 * Every complete `{id, summary}` object in the reply, however it ends.
 *
 * Scans the array element by element rather than parsing the whole document,
 * so a trailing incomplete element costs only itself. The scan tracks string
 * and escape state, because a summary may perfectly legitimately contain
 * braces, brackets or escaped quotes — matching on punctuation alone would
 * split an entry in half at the first `{` somebody wrote in prose.
 */
export function salvageSummaries(raw: string): SalvagedSummary[] {
  const text = unfence(raw);
  if (!text) return [];

  // The whole thing, when it is intact. Much the commonest case, and it also
  // handles any shape the scanner below would have to special-case.
  const whole = tryParseWhole(text);
  if (whole) return whole;

  const start = arrayStart(text);
  if (start < 0) return [];

  const out: SalvagedSummary[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let elementStart = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) elementStart = i;
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && elementStart >= 0) {
        const entry = toSummary(text.slice(elementStart, i + 1));
        if (entry) out.push(entry);
        elementStart = -1;
      }
      continue;
    }
    // The array closed and everything after it is commentary.
    if (ch === ']' && depth === 0) break;
  }

  return out;
}

/** Strip a fenced code block, if the model wrapped its reply in one. */
function unfence(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? trimmed).trim();
}

function tryParseWhole(text: string): SalvagedSummary[] | null {
  // The widest {...} span, so a preamble or trailing commentary cannot stop an
  // otherwise intact reply from parsing. Same idea as `parseExtractionJson`.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  const candidates = [text];
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { summaries?: unknown };
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      if (!Array.isArray(parsed.summaries)) continue;
      return parsed.summaries
        .map((item) => toSummaryFrom(item))
        .filter((s): s is SalvagedSummary => Boolean(s));
    } catch {
      // Truncated or malformed — fall through to the scanner.
    }
  }
  return null;
}

/** Where the summaries array opens. */
function arrayStart(text: string): number {
  const key = text.indexOf('"summaries"');
  if (key < 0) return -1;
  const bracket = text.indexOf('[', key);
  return bracket < 0 ? -1 : bracket + 1;
}

function toSummary(json: string): SalvagedSummary | null {
  try {
    return toSummaryFrom(JSON.parse(json));
  } catch {
    return null;
  }
}

function toSummaryFrom(item: unknown): SalvagedSummary | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as { id?: unknown; summary?: unknown };
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  if (!id || !summary) return null;
  return { id, summary };
}
