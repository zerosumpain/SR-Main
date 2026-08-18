/**
 * CGQL — the codegraph query language.
 *
 * A five-verb, non-Turing set pipeline. It exists because both callers are
 * machines writing queries mechanically, not humans exploring: the build
 * executor composes one from the file set and the last gate error, and jkai
 * composes one from a chat question. Neither needs joins, subqueries or
 * arithmetic, and giving a language more power than its callers use only
 * widens what a prompt-injected string can ask for.
 *
 *   query := stage ('|' stage)*
 *   stage := seed | walk | pick | budget
 *   seed  := 'file:' PATH[,PATH...]      -- glob '*' allowed
 *          | 'gate:' NAME[,NAME...]
 *          | 'fingerprint:' FP[,FP...]   -- the hot lane, plain btree
 *          | 'topic:' "free text"        -- the ONLY vector entry point
 *   walk  := 'hops' INT [edgeKinds]      -- INT in {1,2}, hard cap
 *   pick  := ('episodes'|'lessons'|'nodes') (KEY '=' VALUE)*
 *   budget:= 'budget' INT                -- characters, hard cap 8000
 *
 * Worked examples:
 *   fingerprint:svelte-check:TS2345 | episodes limit=2
 *   file:src/lib/jkai/executor.ts | hops 1 | lessons | episodes verdict=verified,landed limit=3 | budget 5000
 *   topic:"how does the tool bridge authenticate" | lessons limit=5
 *
 * This module is PURE — no database, no I/O, no clock. It parses text into a
 * validated plan; `execute.ts` is the only thing that touches Postgres. Keeping
 * it pure is what makes the grammar cheap to test exhaustively, and the parser
 * is the security boundary: every value that reaches SQL is bound, never
 * interpolated, and every enum is checked against a fixed allow-list here.
 */

export type PickKind = 'episodes' | 'lessons' | 'nodes';

export type Seed =
  | { type: 'file'; paths: string[] }
  | { type: 'gate'; gates: string[] }
  | { type: 'fingerprint'; fingerprints: string[] }
  | { type: 'topic'; text: string };

export interface Pick {
  kind: PickKind;
  verdicts?: string[];
  gate?: string;
  limit: number;
  minWeight?: number;
}

export interface QueryPlan {
  seed: Seed;
  hops: number;
  edgeKinds: string[];
  picks: Pick[];
  budgetChars: number;
}

export class CgqlError extends Error {
  /** Character offset the parse gave up at, so the caller can point at it. */
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'CgqlError';
    this.position = position;
  }
}

/** Verdict tiers, best first. Ranking multiplies by this order. */
export const VERDICTS = ['verified', 'landed', 'unverified', 'repaired', 'abandoned'] as const;
export const EDGE_KINDS = ['co_change', 'needs_context', 'gated_by', 'imports', 'fixed_by'] as const;
const PICK_KINDS: PickKind[] = ['episodes', 'lessons', 'nodes'];

/** Hard caps. A build's context budget is finite and a runaway walk is the
 *  fastest way to blow it; 2 hops on this graph already reaches most of it. */
export const MAX_HOPS = 2;
export const MAX_LIMIT = 10;
export const MAX_BUDGET = 8000;
export const DEFAULT_BUDGET = 5000;

/** Default tail when the caller gives only a seed — the shape that is useful
 *  in a build, so the common case needs no ceremony. */
const DEFAULT_PICKS: Pick[] = [
  { kind: 'lessons', limit: 3 },
  { kind: 'episodes', verdicts: ['verified', 'landed'], limit: 3 },
];

/**
 * A path may contain `*`, and reaches SQL as a LIKE pattern. Anything that is
 * a wildcard in LIKE but not in our grammar (`%`, `_`) must not survive, or a
 * caller could widen its own match silently. `\` would escape our escapes.
 */
function sanitisePath(raw: string, pos: number): string {
  const p = raw.trim();
  if (!p) throw new CgqlError('empty path in file: seed', pos);
  if (p.length > 300) throw new CgqlError('path too long', pos);
  if (/[%\\]/.test(p)) throw new CgqlError(`'%' and '\\' are not allowed in a path`, pos);
  if (p.includes('..')) throw new CgqlError(`'..' is not allowed in a path`, pos);
  return p;
}

/**
 * The one charset for machine-generated tokens (fingerprints, gate names).
 *
 * Shared by the parser AND the query builders, deliberately: they were separate
 * copies for one commit, `@` was added to the parser only, and
 * `cgqlForFingerprints` went on silently returning null for every scoped-package
 * fingerprint — a hot-lane miss with no error anywhere. One regex, one place.
 *
 * `@` is here for scoped npm packages; values are always bound, never
 * interpolated, so the set stays restrictive purely to catch callers doing
 * something unintended.
 */
export const TOKEN_RE = /^[\w.:/@-]+$/;

function sanitiseToken(raw: string, what: string, pos: number): string {
  const t = raw.trim();
  if (!t) throw new CgqlError(`empty ${what}`, pos);
  if (t.length > 200) throw new CgqlError(`${what} too long`, pos);
  // Fingerprints and gate names are machine-generated: word chars, dot, dash,
  // colon, slash, and `@` for scoped npm packages — `fingerprint.ts` emits
  // keys like `vitest:missing-module:@openai/codex-sdk`, and a parser that
  // refuses what its own generator produces makes the hot lane unusable for
  // exactly the errors that recur most. Anything outside this set is a caller
  // doing something unintended. Values are bound, never interpolated.
  if (!TOKEN_RE.test(t)) throw new CgqlError(`invalid character in ${what}: "${t}"`, pos);
  return t;
}

function parseInt10(raw: string, what: string, pos: number): number {
  if (!/^\d{1,6}$/.test(raw.trim())) throw new CgqlError(`${what} must be a whole number`, pos);
  return Number(raw.trim());
}

function parseSeed(text: string, pos: number): Seed {
  const trimmed = text.trim();

  const topic = trimmed.match(/^topic:\s*"([^"]*)"$/) || trimmed.match(/^topic:\s*'([^']*)'$/);
  if (topic) {
    const t = topic[1].trim();
    if (!t) throw new CgqlError('topic: needs some text', pos);
    if (t.length > 500) throw new CgqlError('topic text too long', pos);
    return { type: 'topic', text: t };
  }
  // A bare `topic:` without quotes is the most likely typo; say so precisely
  // rather than falling through to "unknown seed".
  if (/^topic:/.test(trimmed)) {
    throw new CgqlError('topic: text must be quoted, e.g. topic:"the tool bridge"', pos);
  }

  const m = trimmed.match(/^(file|gate|fingerprint):\s*(.+)$/s);
  if (!m) {
    throw new CgqlError(
      `a query must start with file:, gate:, fingerprint: or topic:"..." — got "${trimmed.slice(0, 40)}"`,
      pos,
    );
  }
  const [, kind, rest] = m;
  const parts = rest.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new CgqlError(`${kind}: needs at least one value`, pos);
  if (parts.length > 40) throw new CgqlError(`${kind}: too many values (max 40)`, pos);

  if (kind === 'file') return { type: 'file', paths: parts.map((p) => sanitisePath(p, pos)) };
  if (kind === 'gate') return { type: 'gate', gates: parts.map((p) => sanitiseToken(p, 'gate name', pos)) };
  return { type: 'fingerprint', fingerprints: parts.map((p) => sanitiseToken(p, 'fingerprint', pos)) };
}

function parsePick(words: string[], pos: number): Pick {
  const kind = words[0] as PickKind;
  const pick: Pick = { kind, limit: 3 };

  for (const kv of words.slice(1)) {
    const eq = kv.indexOf('=');
    if (eq === -1) throw new CgqlError(`"${kv}" should be key=value`, pos);
    const key = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    if (!value) throw new CgqlError(`"${key}=" has no value`, pos);

    switch (key) {
      case 'verdict': {
        const vs = value.split(',').map((v) => v.trim()).filter(Boolean);
        for (const v of vs) {
          if (!(VERDICTS as readonly string[]).includes(v)) {
            throw new CgqlError(`unknown verdict "${v}" — one of ${VERDICTS.join(', ')}`, pos);
          }
        }
        pick.verdicts = vs;
        break;
      }
      case 'gate':
        pick.gate = sanitiseToken(value, 'gate name', pos);
        break;
      case 'limit': {
        const n = parseInt10(value, 'limit', pos);
        // Clamp rather than reject: a caller asking for more than the cap wants
        // as much as it can have, and failing the whole query over it would
        // lose the retrieval entirely for a harmless overreach.
        pick.limit = Math.max(1, Math.min(MAX_LIMIT, n));
        break;
      }
      case 'min_weight':
        pick.minWeight = Math.max(1, parseInt10(value, 'min_weight', pos));
        break;
      default:
        throw new CgqlError(`unknown option "${key}" — use verdict, gate, limit or min_weight`, pos);
    }
  }
  return pick;
}

/**
 * Parse CGQL into a validated plan. Throws `CgqlError` with a character
 * position on anything it does not understand — never returns a partial plan,
 * because a silently-truncated query would retrieve the wrong thing and look
 * like it worked.
 */
export function parseCgql(input: string): QueryPlan {
  if (typeof input !== 'string') throw new CgqlError('query must be a string', 0);
  const src = input.trim();
  if (!src) throw new CgqlError('empty query', 0);
  if (src.length > 2000) throw new CgqlError('query too long (max 2000 chars)', 0);

  // Split on '|', tracking offsets so errors can point into the original text.
  const stages: Array<{ text: string; pos: number }> = [];
  let cursor = 0;
  for (const chunk of src.split('|')) {
    stages.push({ text: chunk, pos: cursor });
    cursor += chunk.length + 1;
  }

  const plan: QueryPlan = {
    seed: parseSeed(stages[0].text, stages[0].pos),
    hops: 0,
    edgeKinds: ['co_change', 'needs_context'],
    picks: [],
    budgetChars: DEFAULT_BUDGET,
  };

  let sawBudget = false;
  for (const stage of stages.slice(1)) {
    const words = stage.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) throw new CgqlError('empty stage between two "|"', stage.pos);
    const head = words[0];

    if (head === 'hops') {
      if (words.length < 2) throw new CgqlError('hops needs a number', stage.pos);
      const n = parseInt10(words[1], 'hops', stage.pos);
      if (n > MAX_HOPS) throw new CgqlError(`hops is capped at ${MAX_HOPS}`, stage.pos);
      plan.hops = n;
      if (words[2]) {
        const kinds = words[2].split(',').map((k) => k.trim()).filter(Boolean);
        for (const k of kinds) {
          if (!(EDGE_KINDS as readonly string[]).includes(k)) {
            throw new CgqlError(`unknown edge kind "${k}" — one of ${EDGE_KINDS.join(', ')}`, stage.pos);
          }
        }
        plan.edgeKinds = kinds;
      }
      continue;
    }

    if (head === 'budget') {
      if (words.length < 2) throw new CgqlError('budget needs a number of characters', stage.pos);
      const n = parseInt10(words[1], 'budget', stage.pos);
      plan.budgetChars = Math.max(200, Math.min(MAX_BUDGET, n));
      sawBudget = true;
      continue;
    }

    if (PICK_KINDS.includes(head as PickKind)) {
      plan.picks.push(parsePick(words, stage.pos));
      continue;
    }

    throw new CgqlError(
      `unknown stage "${head}" — expected hops, budget, episodes, lessons or nodes`,
      stage.pos,
    );
  }

  // A seed with no picks is the common machine-written case; give it the shape
  // that is actually useful in a build rather than returning nothing.
  if (!plan.picks.length) plan.picks = DEFAULT_PICKS.map((p) => ({ ...p }));
  if (!sawBudget && plan.budgetChars !== DEFAULT_BUDGET) plan.budgetChars = DEFAULT_BUDGET;

  return plan;
}

/**
 * Build CGQL from a gate failure. This is the hot path: the previous
 * iteration's error IS the sharpest available query, and it costs no LLM call.
 */
export function cgqlForFingerprints(fingerprints: string[], limit = 3): string | null {
  const clean = fingerprints.map((f) => f.trim()).filter((f) => TOKEN_RE.test(f));
  if (!clean.length) return null;
  return `fingerprint:${clean.slice(0, 8).join(',')} | episodes verdict=verified,landed limit=${limit}`;
}

/**
 * Build CGQL from the file set a build is about to touch.
 *
 * The `nodes` pick is not decoration. The walk that selects these lessons
 * already knows which files move WITH the seed — and until this pick existed
 * that neighbourhood was computed, used to pick prose, and then thrown away.
 * The agent is told to "read two existing files of the same shape" before it
 * writes anything; this is the graph answering that instruction with the pairs
 * history actually observed, rather than leaving it to a grep.
 */
export function cgqlForFiles(paths: string[], opts: { hops?: number; budget?: number } = {}): string | null {
  const clean = paths
    .map((p) => p.trim())
    .filter((p) => p && !/[%\\]/.test(p) && !p.includes('..'))
    .slice(0, 20);
  if (!clean.length) return null;
  const hops = Math.min(MAX_HOPS, opts.hops ?? 1);
  const budget = Math.min(MAX_BUDGET, opts.budget ?? DEFAULT_BUDGET);
  return (
    `file:${clean.join(',')} | hops ${hops} | lessons limit=4 | ` +
    `episodes verdict=verified,landed limit=4 | nodes limit=10 | budget ${budget}`
  );
}

/**
 * Split free text into searchable tokens.
 *
 * Lives in this module, not in the retriever, because `planBuildQuery` has to
 * decide whether a task is even askable before any database is involved — and
 * that decision must stay testable without one.
 *
 * Stopwords go, because "how does the tool bridge work" is four noise words and
 * two real ones, and letting "how"/"the" score would rank every note equally.
 * Short tokens go for the same reason.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'does', 'do', 'did',
  'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'this', 'that',
  'it', 'its', 'we', 'you', 'i', 'my', 'our', 'work', 'works', 'use', 'used',
]);

export function topicTokens(text: string, max = 8): string[] {
  const out: string[] = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_.\-/]+/)) {
    const t = raw.replace(/^[-._/]+|[-._/]+$/g, '');
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The floor under a topic query, and why it is three.
 *
 * `topicLessons` requires half a query's tokens to appear in a note, so a
 * two-token seed needs ONE hit — which any common word satisfies, and the
 * answer is then whatever sorted first. Three tokens need two, which is the
 * point at which a match starts meaning something. It also declines exactly the
 * prompts that motivated keying on code in the first place: "crack on" yields
 * one token, "fix the header" two.
 */
export const MIN_TOPIC_TOKENS = 3;

/**
 * Build CGQL from free text — the last resort, for a task that names no file
 * and follows no gate failure.
 *
 * Capped at six tokens deliberately. The scoring floor rises with the token
 * count (half of them must appear), so feeding a whole task paragraph in makes
 * the query STRICTER and returns nothing; the topic searches that work in
 * practice are four or five terms.
 *
 * Episodes are not picked. Their searchable text is a title of the form
 * `gate: fingerprint`, a compiler excerpt and a template sentence — prose about
 * what a build is trying to achieve will not match it except by accident, and
 * an accidental match here is a wrong precedent presented as an authority.
 */
export function cgqlForTopic(text: string, opts: { limit?: number; budget?: number } = {}): string | null {
  const tokens = topicTokens(text, 6);
  if (tokens.length < MIN_TOPIC_TOKENS) return null;
  const limit = Math.min(MAX_LIMIT, opts.limit ?? 4);
  const budget = Math.min(MAX_BUDGET, opts.budget ?? DEFAULT_BUDGET);
  // Tokens are [a-z0-9_.-/] by construction, so no quote can reach the seed and
  // the `topic:"…"` literal cannot be broken out of.
  return `topic:"${tokens.join(' ')}" | lessons limit=${limit} | budget ${budget}`;
}
