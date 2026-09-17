// src/lib/daydream/actions.ts
//
// The action vocabulary — everything daydreaming is allowed to DO, as opposed
// to say. One allow-list shared by the two proposers (the ponder engine's
// one-tap actions and the standing action rules), one validator, one executor.
//
// The owner's D4 decision (2026-08-27): one-tap actions AND standing action
// rules, in the same pass. What keeps that safe is the same shape as the
// detection rules: a proposed action is DATA over this closed vocabulary,
// validated structurally, and a standing rule is inert until the owner
// approves it. The vocabulary starts deliberately small — `remind` — because
// each kind here is a capability grant, and widening it is a decision, not a
// refactor. Deferred work already has a first-class mechanism
// (scheduled_callbacks), so "remind" costs no new machinery.

import type { ProposedAction } from './snapshot-types';

// ── Widened 2026-09-17 ──────────────────────────────────────────────────────
//
// For a year the vocabulary was one word. The engine could notice anything in
// the house, the diary, the graph or the bank, and the only thing it was
// allowed to DO about it was set a reminder — so "acts usefully" had a ceiling
// of one kind of usefulness, and the least ambitious one.
//
// Three more, each already backed by a primitive that exists and none of them
// inventing a new capability out of nothing:
//
//   watch  — a recurring check that notifies on a change (`createMonitor`).
//            This is the expensive one: it generates a workflow, and once
//            armed it can buzz a phone on its own for ever.
//   draft  — write something down in the notebook, for him to read later.
//   ask    — put ONE question to him, as a notebook entry the briefing shows
//            and the next ponder pack cards. His answer comes back through
//            the note → memory path that already exists, which is what makes
//            this a loop rather than a message.
//
// ── The context boundary, and why `watch` has one ──────────────────────────
//
// There are two ways an action reaches the world here and they are NOT equally
// consented. A one-tap action on a thought executes because John pressed it. A
// STANDING RULE executes on its own, for ever, once approved — the owner
// approved a shape, not each firing.
//
// So `watch` is tap-only. A rule that arms monitors is a rule that
// manufactures recurring notifications without anyone reading them first, and
// the whole safety design here is that nothing which can buzz a phone
// auto-activates. `draft` and `ask` are bounded by the rule machinery's own
// once-per-created-thought firing and write only to the notebook, so both are
// allowed in either context.

export const ACTION_KINDS = ['remind', 'watch', 'draft', 'ask'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Where this action is being validated from. A standing rule fires without a
 *  human in the loop; a tap does not. */
export type ActionContext = 'tap' | 'rule';

/** Kinds a STANDING RULE may never carry. See the note above. */
export const TAP_ONLY_KINDS: ReadonlyArray<ActionKind> = ['watch'];

export interface RemindParams {
  /** Hours from now. Bounded: under an hour is a notification wearing a
   *  costume, over a month is a calendar entry's job. */
  inHours: number;
  text: string;
}

export interface WatchParams {
  /** What to check, in words. Handed to the workflow generator verbatim. */
  description: string;
  /** Optional 5-field cron. Absent lets the generator choose a cadence. */
  cron?: string;
}

export interface DraftParams {
  title: string;
  text: string;
}

export interface AskParams {
  /** One question. Not a list: a question he has to unpick into three answers
   *  is a question that does not get answered. */
  question: string;
}

export const REMIND_MIN_HOURS = 1;
export const REMIND_MAX_HOURS = 24 * 30;
export const WATCH_MIN_CHARS = 10;
export const WATCH_MAX_CHARS = 400;
export const DRAFT_MAX_CHARS = 2000;
/** How long a tap will wait for a generated watch before answering honestly.
 *  Under cloudflared's 100s request cut-off, with room for the round trip. */
export const WATCH_BUILD_TIMEOUT_MS = 75_000;
export const ASK_MIN_CHARS = 8;
export const ASK_MAX_CHARS = 240;

/** Five fields, each a cron atom. Deliberately strict — a generated cron is a
 *  schedule that runs for ever, and `* * * * *` is a minute-by-minute loop. */
const CRON_RE = /^(\S+\s+){4}\S+$/;

export type ActionParams = RemindParams | WatchParams | DraftParams | AskParams;

export interface ValidatedAction {
  kind: ActionKind;
  label: string;
  params: ActionParams;
}

/**
 * Validate one proposed action. Returns a reason string on refusal — type
 * mismatches are refused, never coerced, same as the rule validator.
 *
 * `context` defaults to 'tap', which is the permissive one, because every
 * caller that predates the widened vocabulary was a tap. A rule proposer must
 * pass 'rule' explicitly to get the narrower set.
 */
export function validateAction(
  raw: unknown,
  context: ActionContext = 'tap',
): { action: ValidatedAction } | { error: string } {
  if (raw == null || typeof raw !== 'object') return { error: 'action is not an object' };
  const o = raw as Record<string, unknown>;
  const kind = o.kind as ActionKind;
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
    return { error: `unknown action kind: ${String(o.kind)}` };
  }
  if (context === 'rule' && TAP_ONLY_KINDS.includes(kind)) {
    // Not a validation failure — a capability boundary. A standing rule may
    // not arm something that goes on notifying without anyone reading it.
    return { error: `${kind} may only be offered as a one-tap action, never as a standing rule` };
  }

  const params = (o.params ?? o.payload ?? {}) as Record<string, unknown>;
  const givenLabel = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : '';

  if (kind === 'remind') {
    const inHours = typeof params.inHours === 'number' ? params.inHours : NaN;
    const text = typeof params.text === 'string' ? params.text.trim() : '';
    if (!Number.isFinite(inHours) || inHours < REMIND_MIN_HOURS || inHours > REMIND_MAX_HOURS) {
      return { error: `remind.inHours must be ${REMIND_MIN_HOURS}..${REMIND_MAX_HOURS}` };
    }
    if (text.length < 3 || text.length > 200) return { error: 'remind.text must be 3..200 chars' };
    return {
      action: {
        kind,
        label: givenLabel || `Remind me in ${Math.round(inHours)}h`,
        params: { inHours: Math.round(inHours), text },
      },
    };
  }

  if (kind === 'watch') {
    const description = typeof params.description === 'string' ? params.description.trim() : '';
    if (description.length < WATCH_MIN_CHARS || description.length > WATCH_MAX_CHARS) {
      return { error: `watch.description must be ${WATCH_MIN_CHARS}..${WATCH_MAX_CHARS} chars` };
    }
    const cronRaw = typeof params.cron === 'string' ? params.cron.trim() : '';
    if (cronRaw && !CRON_RE.test(cronRaw)) return { error: 'watch.cron must be five fields' };
    return {
      action: {
        kind,
        label: givenLabel || 'Watch this for me',
        params: cronRaw ? { description, cron: cronRaw } : { description },
      },
    };
  }

  if (kind === 'draft') {
    const title = typeof params.title === 'string' ? params.title.trim() : '';
    const text = typeof params.text === 'string' ? params.text.trim() : '';
    if (title.length < 3 || title.length > 120) return { error: 'draft.title must be 3..120 chars' };
    if (text.length < 10 || text.length > DRAFT_MAX_CHARS) {
      return { error: `draft.text must be 10..${DRAFT_MAX_CHARS} chars` };
    }
    return { action: { kind, label: givenLabel || 'Write this up for me', params: { title, text } } };
  }

  const question = typeof params.question === 'string' ? params.question.trim() : '';
  if (question.length < ASK_MIN_CHARS || question.length > ASK_MAX_CHARS) {
    return { error: `ask.question must be ${ASK_MIN_CHARS}..${ASK_MAX_CHARS} chars` };
  }
  if (question.split('?').length > 3) {
    // Two question marks is two questions wearing one action.
    return { error: 'ask.question must be a single question' };
  }
  return { action: { kind: 'ask', label: givenLabel || 'Answer this', params: { question } } };
}

/** Serialise for the thought row's proposedActions column, which predates this
 *  module and stores {kind,label,payload} with a string payload. */
export function toProposedAction(a: ValidatedAction): ProposedAction {
  return { kind: a.kind, label: a.label, payload: JSON.stringify(a.params) };
}

/** The reverse: a stored proposedAction back through the validator, so the
 *  execute path can never run anything the propose path would have refused. */
export function fromProposedAction(p: ProposedAction): { action: ValidatedAction } | { error: string } {
  let params: unknown;
  try {
    params = JSON.parse(p.payload);
  } catch {
    return { error: 'payload is not JSON' };
  }
  return validateAction({ kind: p.kind, label: p.label, params });
}

export interface ExecuteResult {
  ok: boolean;
  detail: string;
}

/**
 * Execute a validated action.
 *
 * `remind` rides the scheduled-callbacks engine as a `reply` into the most
 * recent conversation — the same channel daydream thoughts already use. The
 * callback NAME is derived from the caller's key, and names are unique with
 * update-on-reuse semantics, so a standing rule that fires on consecutive
 * ticks moves its one reminder rather than stacking thirty.
 */
export async function executeAction(
  action: ValidatedAction,
  opts: { key: string; now?: Date },
): Promise<ExecuteResult> {
  const now = opts.now ?? new Date();

  if (action.kind === 'remind') {
    // Imports live here, not at module level, so the validators above stay
    // pure and importable from the rules spec without dragging in the db.
    const { db } = await import('$lib/db');
    const { scheduledCallbacks } = await import('$lib/db/schema');
    const { latestConversationId } = await import('./deliver');
    const p = action.params as RemindParams;
    const conversationId = await latestConversationId();
    if (!conversationId) return { ok: false, detail: 'no conversation to remind into' };
    const fireAt = new Date(now.getTime() + p.inHours * 3_600_000);
    const name = `daydream:${opts.key}`.slice(0, 120);
    await db
      .insert(scheduledCallbacks)
      .values({
        name,
        description: `daydream reminder: ${p.text.slice(0, 80)}`,
        fireAt,
        kind: 'reply',
        conversationId,
        payload: { text: `⏰ ${p.text}`, notifyWhatsApp: true },
        source: 'system',
      })
      .onConflictDoUpdate({
        target: scheduledCallbacks.name,
        set: {
          fireAt,
          payload: { text: `⏰ ${p.text}`, notifyWhatsApp: true },
          status: 'pending',
          updatedAt: now,
        },
      });
    return { ok: true, detail: `reminder set for ${fireAt.toISOString()}` };
  }

  if (action.kind === 'watch') {
    // The costly one, and the only kind a standing rule may not carry.
    // `createMonitor` generates a workflow, which is a model call — it is
    // behind a tap precisely because of that, and because what it produces
    // keeps notifying after everyone has stopped thinking about it.
    const { createMonitor } = await import('$lib/monitors/monitors.server');
    const p = action.params as WatchParams;
    try {
      // `createMonitor` GENERATES a workflow, so it is a model call and can
      // run for a minute or more. Every other action here returns in
      // milliseconds; this one is reached from an HTTP tap, and cloudflared
      // cuts a request off at 100s. Racing it means the tap always gets a
      // truthful answer rather than a gateway error over work that succeeded.
      //
      // The losing promise is deliberately NOT cancelled: the monitor is still
      // worth having, and `createMonitor` has no abort to hand anyway. The
      // message says where it will appear instead of claiming it is there.
      const marker = await Promise.race([
        createMonitor(p.description, p.cron),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), WATCH_BUILD_TIMEOUT_MS)),
      ]);
      if (!marker) {
        return {
          ok: true,
          detail: 'the watch is still being built — it will appear on /jkai/daydreams/watches shortly',
        };
      }
      return { ok: true, detail: `watch created: ${marker.slug} (${marker.cron})` };
    } catch (err) {
      return { ok: false, detail: `could not create the watch: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (action.kind === 'draft') {
    // Into the notebook, where the next ponder pack will card it back. A
    // draft nobody reads is at least a draft the engine can build on.
    const { saveNote } = await import('./notebook/store');
    const p = action.params as DraftParams;
    const note = await saveNote({
      title: p.title,
      body: p.text,
      folder: 'Daydream',
      tags: ['draft', 'daydream'],
    });
    return { ok: true, detail: `draft saved as note ${note.id}` };
  }

  if (action.kind === 'ask') {
    // One question, put where he will see it and where the answer can come
    // back. The briefing shows the notebook's open questions and the ponder
    // pack cards them, so an answer typed into the note reaches the next
    // cycle through the path notes already take.
    const { saveNote } = await import('./notebook/store');
    const p = action.params as AskParams;
    const note = await saveNote({
      title: p.question,
      body: '',
      folder: 'Questions',
      tags: ['question', 'daydream'],
    });
    return { ok: true, detail: `question filed as note ${note.id}` };
  }

  return { ok: false, detail: `unhandled kind ${(action as ValidatedAction).kind}` };
}
