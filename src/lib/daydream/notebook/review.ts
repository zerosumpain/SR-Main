// src/lib/daydream/notebook/review.ts
//
// Reading a note, and deciding what would actually help.
//
// ── The shape, and why it is this shape ────────────────────────────────────
//
// The model gets one note and returns a PLAN — a short list of actions over the
// closed vocabulary in ./actions. It gets no tools, no URLs and no way to write
// anything. Code validates every item, refuses what it cannot accept, executes
// what it can, and records both halves.
//
// That is the same division `ponder/run.ts` and `rules/propose.ts` already use,
// and it exists because a model that is good at noticing what a note is about
// is not therefore something you hand a research runner and a graph to. The
// noticing is the valuable part; the doing is code's job.
//
// ── What it is looking for ─────────────────────────────────────────────────
//
// The owner's words: "research topics, intelligence links, documents, people,
// places or dates that might be useful, and creating supporting information".
// Three actions cover it, and the prompt says plainly that doing NOTHING is a
// good answer — a note that reads "get milk" should cost one cheap call and
// produce an empty plan, not a research session about dairy.

import { getLLMClient } from '$lib/llm/client';
import { DEFAULT_NOTE_REVIEW_MODEL_ID } from '$lib/constants/default-models';
import { resolveNoteReviewModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { errMsg } from '../types';
import {
  MAX_CONTEXT,
  NOTE_ACTION_KINDS,
  SHORT_DEPTHS,
  validateNoteAction,
  type ValidatedNoteAction,
} from './actions';

/**
 * The reviewer's model when nothing is pinned.
 *
 * The FALLBACK, not the answer — the role is the `notebook-review` workload and
 * its effective model comes from `resolveNoteReviewModel()`, settable on
 * /admin/ops/costs. Until 2026-09-03 this literal was the only way to change
 * it.
 *
 * Same reasoning as the adjudicator for the default: Luna is the cheap 5.6 the
 * catalogue calls "best fit for background site tasks", which is exactly this.
 * Reading one note and naming a couple of useful lookups is not a hard problem
 * — the money is better spent on the research the plan asks for than on the
 * planning.
 */
export const NOTE_REVIEW_MODEL = DEFAULT_NOTE_REVIEW_MODEL_ID;

/** At most this many actions from one note. A note is an idea, not a project
 *  plan, and an unbounded list is how one note spends the whole cap. */
export const MAX_ACTIONS_PER_NOTE = 3;

/** How much of a long note the model sees. A blog draft can run to thousands of
 *  words; the first few thousand characters say what it is about. */
export const MAX_NOTE_CHARS = 6_000;

const SYSTEM = [
  "You are reading John's private notebook. A note is a middleground place for an idea — a thought, a task, a blog musing, something half-formed. Your job is to decide what, if anything, would genuinely help this note along.",
  '',
  'Reply with ONE JSON object and nothing else:',
  '{"summary":"one line on what this note is about","actions":[ ... ]}',
  '',
  // ── Worked examples, not a description ─────────────────────────────────
  //
  // The first live run planned a perfectly sensible research action and the
  // validator refused it, because the prompt described the kinds in prose and
  // never once named the field `topic`. That is the same fault that kept the
  // lead frontier empty for a fortnight: the runtime knew the vocabulary and
  // the prompt did not show it. Exact shapes, spelled out, every field named.
  'You may plan at most ' + MAX_ACTIONS_PER_NOTE + ' actions. Each is EXACTLY one of these three shapes — copy the field names literally:',
  '',
  '  {"kind":"research","title":"Heat pump install costs","params":{',
  '     "topic":"air source heat pump installation cost UK 2026",   <- REQUIRED, 5+ chars, what to search for',
  '     "depth":"scan",                                             <- REQUIRED, "scan" or "brief" ONLY',
  '     "goals":["typical install cost","grant eligibility"]        <- optional, up to 3',
  '  }}',
  '',
  '  {"kind":"link","title":"This is about Hush Digital","params":{',
  '     "refKind":"intel-entity",   <- REQUIRED: intel-entity | intel-note | research | note',
  '     "refId":"<an id from the list below>",  <- REQUIRED, and ONLY an id you were actually shown',
  '     "why":"the note names this organisation"  <- REQUIRED, 5+ chars',
  '  }}',
  '',
  '  {"kind":"context","title":"What the standard says","params":{',
  '     "text":"Background you write yourself, 20+ characters."  <- REQUIRED',
  '  }}',
  '',
  'What each is for:',
  '  research — something in the note is worth actually finding out. Short runs only;',
  '             a longer depth will be refused outright, not downgraded.',
  '  link     — the note is about a person, place, organisation, document or past',
  '             piece of research the graph ALREADY knows. Never invent an id.',
  '  context  — supporting information you write: background, the obvious',
  '             counter-argument, a definition, what this connects to.',
  '',
  'Rules that matter more than being helpful:',
  '- AN EMPTY LIST IS A GOOD ANSWER. "Buy milk", a shopping list, a private',
  '  reflection or a note that is already finished needs nothing from you.',
  '  Planning work on those wastes his budget and clutters the note.',
  '- Never plan research on something personal, medical or about a named family',
  '  member. Those are his to think about, not yours to look up on the web.',
  '- You are NOT editing the note. `context` is appended in its own block and',
  '  shown as yours; it never replaces what he wrote.',
  '- Put every parameter inside "params". An action with its fields at the top',
  '  level will be refused.',
  '- title is one short line saying what the action gets him.',
].join('\n');

export interface NotePlan {
  summary: string;
  actions: ValidatedNoteAction[];
  /** Plans the validator refused, kept so a model reaching past its vocabulary
   *  is visible rather than silently ignored. */
  refused: Array<{ kind: string; title: string; error: string }>;
  tokens: { prompt: number; completion: number };
  error: string | null;
}

const EMPTY: NotePlan = {
  summary: '',
  actions: [],
  refused: [],
  tokens: { prompt: 0, completion: 0 },
  error: null,
};

/**
 * Parse and validate the model's reply.
 *
 * Pure, so the refusal rules are testable without a model. Anything
 * unrecognised is REFUSED and recorded, never coerced into the nearest legal
 * value — silently rewriting `investigation` to `scan` would hide the single
 * most important thing this validator has to catch.
 */
export function parsePlan(raw: string): Omit<NotePlan, 'tokens'> {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { summary: '', actions: [], refused: [], error: 'reviewer did not return JSON' };
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 300) : '';
  const list = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions: ValidatedNoteAction[] = [];
  const refused: NotePlan['refused'] = [];

  for (const item of list.slice(0, MAX_ACTIONS_PER_NOTE * 2)) {
    if (actions.length >= MAX_ACTIONS_PER_NOTE) break;
    const res = validateNoteAction(item);
    if ('action' in res) {
      actions.push(res.action);
    } else {
      const o = (item ?? {}) as Record<string, unknown>;
      refused.push({
        kind: typeof o.kind === 'string' ? o.kind : 'unknown',
        title: typeof o.title === 'string' ? o.title : '(no title)',
        error: res.error,
      });
    }
  }
  return { summary, actions, refused, error: null };
}

export interface NoteForReview {
  id: string;
  title: string;
  body: string;
  folder: string;
  /** Ids the model is allowed to reference in a `link`. Supplying them is what
   *  makes a link real rather than invented — the same fix that stopped the
   *  lead writer picking from a vocabulary it had never been shown. */
  knownRefs?: Array<{ refKind: string; refId: string; label: string }>;
}

/**
 * Review one note.
 *
 * Never throws. A reviewer that cannot run leaves the note unreviewed, which is
 * the safe direction: an unreviewed note is exactly a note, and the notebook
 * works perfectly without any of this.
 */
export function reviewNote(note: NoteForReview): Promise<NotePlan> {
  // Tagged so the call lands on the `notebook-review` row of /admin/ops/costs
  // rather than in the untagged gateway bucket — the row that switches it.
  return withActivity('notebook-review', () => runNoteReview(note));
}

async function runNoteReview(note: NoteForReview): Promise<NotePlan> {
  try {
    const { client, model } = await getLLMClient(await resolveNoteReviewModel());

    const refs = (note.knownRefs ?? []).slice(0, 25);
    const userMsg = [
      `NOTE${note.folder ? ` (folder: ${note.folder})` : ''}`,
      `TITLE: ${note.title || '(untitled)'}`,
      '',
      note.body.slice(0, MAX_NOTE_CHARS),
      '',
      refs.length
        ? [
            'THINGS THE GRAPH ALREADY KNOWS, which you may `link` to by id:',
            ...refs.map((r) => `  [${r.refKind}:${r.refId}] ${r.label}`),
          ].join('\n')
        : 'The graph has nothing obviously related, so do not plan a `link`.',
    ].join('\n');

    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ] as never,
      max_tokens: 1_200,
    } as never);

    const tokens = {
      prompt: res.usage?.prompt_tokens ?? 0,
      completion: res.usage?.completion_tokens ?? 0,
    };
    const content = (res.choices?.[0]?.message as { content?: string } | undefined)?.content ?? '';
    return { ...parsePlan(content), tokens };
  } catch (err) {
    return { ...EMPTY, error: errMsg(err).slice(0, 300) };
  }
}

/** Re-exported so the activity and the tests can state the limits without
 *  reaching into two modules. */
export const REVIEW_LIMITS = {
  kinds: NOTE_ACTION_KINDS,
  depths: SHORT_DEPTHS,
  maxActions: MAX_ACTIONS_PER_NOTE,
  maxContext: MAX_CONTEXT,
} as const;
