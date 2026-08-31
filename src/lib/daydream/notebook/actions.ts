// src/lib/daydream/notebook/actions.ts
//
// Everything the note reviewer is allowed to DO, as opposed to say.
//
// Same shape and the same argument as `$lib/daydream/actions` — one allow-list,
// one validator, one executor, and a vocabulary that starts small because
// **each kind here is a capability grant, and widening it is a decision rather
// than a refactor**. The model proposes over this list as DATA; it never gets a
// tool, a URL or a free-text command.
//
// ── The three, and why exactly these ───────────────────────────────────────
//
//   research  — the note names something worth actually finding out. SHORT
//               tiers only; see the refusal below, which is the load-bearing
//               line in this file.
//   link      — the note is about something the knowledge graph already knows.
//               Records the connection; reads, never writes, the graph.
//   context   — supporting information the model wrote, appended to the note
//               in its own attributed block.
//
// The owner's list was "research topics, intelligence links, documents, people,
// places or dates that might be useful, and creating supporting information".
// `link` covers documents, people, places and dates, because in this codebase
// all four are already entities or notes in intel — inventing a separate
// `find_documents` kind would be a fourth capability for a lookup the third
// already performs.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
//
// Nothing that writes outside the note: no reminders, no calendar entries, no
// messages, no edits to John's text. A note is a thinking surface, and a model
// reading one to be helpful is not a reason to hand it the diary.

import type { ResearchDepth } from '$lib/deepdive/depth';

export const NOTE_ACTION_KINDS = ['research', 'link', 'context'] as const;
export type NoteActionKind = (typeof NOTE_ACTION_KINDS)[number];

/**
 * The only research depths this path may ask for.
 *
 * THE load-bearing constraint. `scan` (~90s) and `brief` (~2min) carry a
 * `budgetMs`, which is what makes `research_start` run them synchronously and
 * return an answer. `investigation` has `budgetMs == null`: it detaches into
 * the background and runs for twenty minutes or more. Firing one of those off
 * an idle heartbeat tick, per note, is how a notebook of thirty ideas becomes
 * an afternoon of unattended crawling.
 *
 * So the refusal is structural rather than advisory — the validator rejects the
 * depth, and there is no path from a note to the unbounded runner at all.
 */
export const SHORT_DEPTHS = ['scan', 'brief'] as const satisfies readonly ResearchDepth[];
export type ShortDepth = (typeof SHORT_DEPTHS)[number];

/** Things `link` may point at. Each is a row the page can build a URL for. */
export const LINK_KINDS = ['intel-entity', 'intel-note', 'research', 'note'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface ResearchParams {
  topic: string;
  depth: ShortDepth;
  goals: string[];
}
export interface LinkParams {
  refKind: LinkKind;
  refId: string;
  why: string;
}
export interface ContextParams {
  text: string;
}

export interface ValidatedNoteAction {
  kind: NoteActionKind;
  /** One line, as the model phrased it. Shown on the note's action list. */
  title: string;
  params: ResearchParams | LinkParams | ContextParams;
}

/** Bounds. A note is a paragraph or two, and an action about it should be too. */
export const MAX_TITLE = 120;
export const MAX_TOPIC = 200;
export const MAX_GOALS = 3;
export const MAX_CONTEXT = 2_000;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** The keys an action actually arrived with, for a refusal message that can be
 *  acted on. Keys only — a note's contents are private and a validation error
 *  is not a reason to copy them into a log. */
function describe(p: Record<string, unknown>): string {
  const keys = Object.keys(p ?? {});
  return keys.length ? `params with keys [${keys.join(', ')}]` : 'empty params';
}

function isNoteActionKind(v: unknown): v is NoteActionKind {
  return typeof v === 'string' && (NOTE_ACTION_KINDS as readonly string[]).includes(v);
}

/**
 * Validate one planned action.
 *
 * Returns a reason string on refusal — type mismatches are REFUSED, never
 * coerced, for the reason `tool-arg-alias` cost two toolsets half their calls:
 * a coerced argument turns a spelling mistake into a confident wrong answer,
 * and the resulting error is always a domain claim rather than "you asked for
 * something you are not allowed to ask for".
 */
export function validateNoteAction(raw: unknown): { action: ValidatedNoteAction } | { error: string } {
  if (raw == null || typeof raw !== 'object') return { error: 'action is not an object' };
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  // A type predicate, not a bare `includes` — the latter leaves `kind` as
  // `string`, so the `context` branch at the foot never narrows and the return
  // does not type-check. Narrowing here is also what makes the two early
  // returns below exhaustive.
  if (!isNoteActionKind(kind)) return { error: `unknown action kind: ${String(kind)}` };
  const p = (o.params ?? {}) as Record<string, unknown>;
  const title = str(o.title, MAX_TITLE);
  if (title.length < 3) return { error: 'action needs a title of at least 3 characters' };

  if (kind === 'research') {
    const topic = str(p.topic, MAX_TOPIC);
    if (topic.length < 5) {
      // Names what it actually received. The first live refusal read
      // "research.topic must be at least 5 characters" against a model that had
      // clearly understood the note perfectly — and the useful information,
      // that `params` held something else entirely, was nowhere on the page.
      return { error: `research.topic must be at least 5 characters — got ${describe(p)}` };
    }
    const depth = typeof p.depth === 'string' ? p.depth : '';
    if (!(SHORT_DEPTHS as readonly string[]).includes(depth)) {
      // Named explicitly rather than silently downgraded: a model that keeps
      // asking for `investigation` is telling you something, and quietly
      // rewriting it to `scan` would hide that AND make the refusal untestable.
      return { error: `research.depth must be one of ${SHORT_DEPTHS.join(', ')} — "${depth}" is not a short run` };
    }
    const goals = Array.isArray(p.goals)
      ? p.goals.filter((g): g is string => typeof g === 'string').map((g) => g.trim()).filter(Boolean).slice(0, MAX_GOALS)
      : [];
    return { action: { kind, title, params: { topic, depth: depth as ShortDepth, goals } } };
  }

  if (kind === 'link') {
    const refKind = typeof p.refKind === 'string' ? p.refKind : '';
    if (!(LINK_KINDS as readonly string[]).includes(refKind)) {
      return { error: `link.refKind must be one of ${LINK_KINDS.join(', ')}` };
    }
    const refId = str(p.refId, 120);
    if (!refId) return { error: 'link.refId is required' };
    const why = str(p.why, 300);
    if (why.length < 5) return { error: 'link.why must say why in at least 5 characters' };
    return { action: { kind, title, params: { refKind: refKind as LinkKind, refId, why } } };
  }

  // context
  const text = str(p.text, MAX_CONTEXT);
  if (text.length < 20) return { error: 'context.text must be at least 20 characters' };
  return { action: { kind, title, params: { text } } };
}

export interface NoteActionResult {
  ok: boolean;
  /** One line for the note's action list. */
  result: string;
  refKind?: string;
  refId?: string;
}

/**
 * Execute one validated action.
 *
 * Never throws — a failing action records `failed` against the note and the
 * review carries on with the next one. One dud lookup must not cost the whole
 * pass, and a silent failure would leave a `planned` row that never resolves.
 */
export async function executeNoteAction(
  noteId: string,
  action: ValidatedNoteAction,
): Promise<NoteActionResult> {
  try {
    if (action.kind === 'research') {
      const { topic, depth, goals } = action.params as ResearchParams;
      const { executeTool } = await import('$lib/workflows/site-tools/registry');
      // A budgeted depth runs SYNCHRONOUSLY inside research_start and returns
      // the answer, which is the whole reason only the short tiers are allowed:
      // there is no polling, no background task and no unbounded crawl.
      const res = await executeTool('research_start', { topic, depth, goals });
      if (!res?.success) return { ok: false, result: String(res?.error ?? 'research failed') };
      const d = (res.data ?? {}) as { id?: string; answer?: string; status?: string };
      return {
        ok: true,
        result: (d.answer || `research ${d.status ?? 'finished'}`).slice(0, 1_000),
        refKind: 'research',
        refId: d.id,
      };
    }

    if (action.kind === 'link') {
      const { refKind, refId, why } = action.params as LinkParams;
      // Recorded, not verified against the graph here: `resolveLink` on the
      // page renders a dead link as dead, which is honest, whereas a lookup per
      // planned action would put N queries behind one review.
      return { ok: true, result: why, refKind, refId };
    }

    // context — appended to the note in its own attributed block.
    const { appendSupporting } = await import('./store');
    const { text } = action.params as ContextParams;
    await appendSupporting(noteId, text);
    return { ok: true, result: `${text.length} characters of supporting notes added` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, result: msg.slice(0, 300) };
  }
}
