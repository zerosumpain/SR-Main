// src/lib/daydream/think/explain.ts
//
// A think note in the reader's words. PURE — the web feed, the phone and the
// commission sign-off all share it, so a source reads the same everywhere.
//
// Three jobs:
//   * split the note's own `Next:` line (run.ts `narrativeOf`) out of the body,
//     so the suggested step can be drawn as the thing to do, not a paragraph;
//   * turn each cited tool card (`<tool>:<stable args>@<day>`) into a label a
//     person would write — "Bank spend · Canva · 60 days", never
//     `spend({"days":60,"merchant":"Canva"})`;
//   * say where a note is in its journey — the four stages the UI teaches.

/** The four stages every daydream surface uses, in order. */
export const STAGES = ['spotted', 'decide', 'motion', 'result'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  spotted: 'Spotted',
  decide: 'Your call',
  motion: 'In motion',
  result: 'Result',
};

/** What each stage means, one sentence, second person. */
export const STAGE_EXPLAIN: Record<Stage, string> = {
  spotted: 'jkai looks at one part of your life at a time and writes down anything worth your attention, citing what it read.',
  decide: 'You decide what it is worth: keep it, have the facts checked again, or tell it this is not for you.',
  motion: 'Anything you approve runs on its own — a fresh check of the sources, or a build idea waiting in the build queue.',
  result: 'The report comes back or the build ships. Your verdicts are the score it learns from.',
};

/** The filter a note sits under on the Inbox. */
export type Bucket = 'decide' | 'motion' | 'done';

// ── The body and its next step ─────────────────────────────────────────────

export interface SplitNarrative {
  /** Everything before the `Next:` line. */
  summary: string;
  /** The suggested step, without its label. Null when the note has none. */
  next: string | null;
}

const NEXT_RE = /\n\s*\n\s*Next:\s*([\s\S]+)$/;

export function splitNarrative(body: string | null | undefined): SplitNarrative {
  const text = (body ?? '').trim();
  const m = NEXT_RE.exec(text);
  if (!m) {
    // A note that is ONLY a next step (no body before it).
    const lone = /^Next:\s*([\s\S]+)$/.exec(text);
    if (lone) return { summary: '', next: lone[1].trim() };
    return { summary: text, next: null };
  }
  return { summary: text.slice(0, m.index).trim(), next: m[1].trim() || null };
}

// ── Sources ────────────────────────────────────────────────────────────────

export interface SourceLine {
  /** The kind of place it looked — "Bank spend", "Your diary". */
  label: string;
  /** What exactly — "Canva · last 60 days". Empty when the label says it all. */
  detail: string;
  /** For a web page: the address, so the reader can open it. */
  href?: string;
}

type Args = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map(str).filter(Boolean);
const quote = (s: string): string => `“${s.length > 48 ? `${s.slice(0, 47)}…` : s}”`;
const words = (s: string): string => s.replace(/[_.]+/g, ' ').trim();
const join = (...parts: Array<string | null | false | undefined>): string => parts.filter(Boolean).join(' · ');

function days(n: number | null, dir: 'back' | 'ahead' = 'back'): string | null {
  if (n == null) return null;
  return dir === 'back' ? `last ${n} days` : `next ${n} days`;
}

/** "+14d" / "today" / an ISO date → words. */
function when(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const rel = /^\+(\d+)d$/.exec(s);
  if (rel) return `${rel[1]} days ahead`;
  const back = /^-(\d+)d$/.exec(s);
  if (back) return `${back[1]} days ago`;
  return s.slice(0, 10);
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

const HUB_SECTION_WORDS: Record<string, string> = {
  read: 'the read',
  tiles: 'headline figures',
  instruments: 'instruments',
  forecasts: 'forecasts',
  moves: 'suggested moves',
  tripwires: 'tripwires',
  plan: 'the plan',
  experiments: 'experiments',
  verdict: 'the verdict',
};

/** One cited card → a plain line. Unknown tools still say something honest. */
export function describeSource(tool: string, args: Args): SourceLine {
  switch (tool) {
    case 'spend':
      return { label: 'Bank spend', detail: join(str(args.merchant), days(num(args.days) ?? 60)) };
    case 'mail_facts':
      return {
        label: 'Mail (facts, not bodies)',
        detail: join(str(args.query) && quote(str(args.query)), days(num(args.daysBack) ?? 14), num(args.daysAhead) ? days(num(args.daysAhead), 'ahead') : null),
      };
    case 'diary': {
      const from = when(args.from) || 'today';
      const to = when(args.to) || '14 days ahead';
      return { label: 'Your diary', detail: join(`${from} to ${to}`, str(args.query) && quote(str(args.query))) };
    }
    case 'chat_threads':
      return { label: 'Your jkai chats', detail: days(num(args.days) ?? 14) ?? '' };
    case 'activities':
      return { label: 'Recent workouts and outings', detail: num(args.limit) ? `latest ${num(args.limit)}` : '' };
    case 'health_hub': {
      const secs = list(args.sections).map((s) => HUB_SECTION_WORDS[s] ?? words(s));
      return { label: 'Your /health summary', detail: secs.length > 4 ? `${secs.slice(0, 3).join(', ')} and ${secs.length - 3} more` : secs.join(', ') };
    }
    case 'health_series':
      return { label: 'Health trend', detail: join(words(str(args.metric)), days(num(args.days) ?? 28)) };
    case 'health_timeline':
      return { label: 'Health timeline', detail: '' };
    case 'correlate':
      return {
        label: 'Tested a link',
        detail: join(`${words(str(args.a)) || '?'} against ${words(str(args.b)) || '?'}`, days(num(args.days) ?? 90)),
      };
    case 'ha_find': {
      const what = [...list(args.domain).map(words), ...list(args.area)];
      return { label: 'Home sensors', detail: join(what.join(', '), str(args.query) && quote(str(args.query))) || 'everything in the house' };
    }
    case 'ha_query_state':
      return { label: 'Home — current state', detail: words(str(args.entity_id ?? args.entityId).split('.').pop() ?? '') };
    case 'ha_get_history':
      return { label: 'Home — history', detail: words(str(args.entity_id ?? args.entityId).split('.').pop() ?? '') };
    case 'memory_search':
      return { label: 'jkai memory', detail: str(args.query) ? quote(str(args.query)) : 'most recent' };
    case 'research_web_search':
      return { label: 'Web search', detail: quote(str(args.query)) };
    case 'fetch_url': {
      const url = str(args.url);
      return { label: 'Web page', detail: host(url), href: /^https?:\/\//.test(url) ? url : undefined };
    }
    default:
      return { label: words(tool) || 'A source', detail: '' };
  }
}

/** A card reference: `<tool>:<[[k,v],…]>@<yyyy-mm-dd>`. */
const REF_RE = /^([a-z_]+):(\[.*\])@\d{4}-\d{2}-\d{2}$/;

export function parseCardRef(ref: string): { tool: string; args: Args } | null {
  const m = REF_RE.exec(ref);
  if (!m || m[2].length > 4000) return null;
  try {
    const pairs: unknown = JSON.parse(m[2]);
    if (!Array.isArray(pairs)) return null;
    const args: Args = {};
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string') continue;
      if (p[0] === '__proto__' || p[0] === 'constructor' || p[0] === 'prototype') continue;
      args[p[0]] = p[1];
    }
    return { tool: m[1], args };
  } catch {
    return null;
  }
}

/** Every distinct source a note cited, in the order it read them. */
export function describeSources(evidence: unknown): SourceLine[] {
  if (!Array.isArray(evidence)) return [];
  const out: SourceLine[] = [];
  const seen = new Set<string>();
  for (const e of evidence as Array<{ kind?: unknown; id?: unknown }>) {
    if (e?.kind !== 'think-card' || typeof e.id !== 'string') continue;
    const parsed = parseCardRef(e.id);
    if (!parsed) continue;
    const line = describeSource(parsed.tool, parsed.args);
    const key = `${line.label}|${line.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.slice(0, 12);
}

/** A source as one string — the phone's chip, a tooltip. */
export function sourceText(s: SourceLine): string {
  return s.detail ? `${s.label} · ${s.detail}` : s.label;
}

// ── Where a note is ────────────────────────────────────────────────────────

/** Commission states grouped by who holds the next move. `deferred` is his
 *  "not now": it comes back for his OK by itself, so it waits with the work
 *  in motion rather than in his inbox. */
const COMMISSION_NEEDS_YOU = new Set(['awaiting_approval', 'needs_attention']);
const COMMISSION_RUNNING = new Set(['queued', 'running', 'deferred']);

export interface StageInput {
  verdict: string | null;
  commissionState?: string | null;
  /** The build-queue item a build idea became, if any. */
  build?: { status: string; accepted: boolean } | null;
  /** "Do it for me" carried the step out (and it was not undone). */
  acted?: boolean;
  /** A follow-up waiting on him, or running without him (`followStage`). */
  following?: 'decide' | 'motion' | null;
}

/**
 * The furthest stage a note has reached, and the Inbox bucket it belongs in.
 *
 * `decide` holds everything waiting on the owner: an unrated note, a check
 * awaiting sign-off or stuck, and a report that came back to an unrated note.
 * `motion` is work that runs without him. `done` is rated with nothing pending.
 */
export function noteStage(i: StageInput): { stage: Stage; bucket: Bucket } {
  const c = i.commissionState ?? null;
  // Done is done: nothing left to decide or wait for.
  if (i.acted) return { stage: 'result', bucket: 'done' };
  if (c && COMMISSION_NEEDS_YOU.has(c)) return { stage: 'decide', bucket: 'decide' };
  if (c && COMMISSION_RUNNING.has(c)) return { stage: 'motion', bucket: 'motion' };
  if (i.following === 'decide') return { stage: 'decide', bucket: 'decide' };
  if (i.following === 'motion') return { stage: 'motion', bucket: 'motion' };
  const shipped = i.build?.status === 'shipped';
  const building = !!i.build && i.build.accepted && i.build.status === 'open';
  if (c === 'completed' || shipped) return { stage: 'result', bucket: i.verdict ? 'done' : 'decide' };
  if (building) return { stage: 'motion', bucket: 'motion' };
  if (!i.verdict) return { stage: 'spotted', bucket: 'decide' };
  return { stage: 'decide', bucket: 'done' };
}
