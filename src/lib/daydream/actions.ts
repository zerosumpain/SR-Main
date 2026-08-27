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

export const ACTION_KINDS = ['remind'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface RemindParams {
  /** Hours from now. Bounded: under an hour is a notification wearing a
   *  costume, over a month is a calendar entry's job. */
  inHours: number;
  text: string;
}

export const REMIND_MIN_HOURS = 1;
export const REMIND_MAX_HOURS = 24 * 30;

export interface ValidatedAction {
  kind: ActionKind;
  label: string;
  params: RemindParams;
}

/**
 * Validate one proposed action. Returns a reason string on refusal — type
 * mismatches are refused, never coerced, same as the rule validator.
 */
export function validateAction(raw: unknown): { action: ValidatedAction } | { error: string } {
  if (raw == null || typeof raw !== 'object') return { error: 'action is not an object' };
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'remind') return { error: `unknown action kind: ${String(o.kind)}` };

  const params = (o.params ?? o.payload ?? {}) as Record<string, unknown>;
  const inHours = typeof params.inHours === 'number' ? params.inHours : NaN;
  const text = typeof params.text === 'string' ? params.text.trim() : '';
  if (!Number.isFinite(inHours) || inHours < REMIND_MIN_HOURS || inHours > REMIND_MAX_HOURS) {
    return { error: `remind.inHours must be ${REMIND_MIN_HOURS}..${REMIND_MAX_HOURS}` };
  }
  if (text.length < 3 || text.length > 200) {
    return { error: 'remind.text must be 3..200 chars' };
  }

  const label =
    typeof o.label === 'string' && o.label.trim()
      ? o.label.trim().slice(0, 60)
      : `Remind me in ${Math.round(inHours)}h`;

  return { action: { kind: 'remind', label, params: { inHours: Math.round(inHours), text } } };
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
    const conversationId = await latestConversationId();
    if (!conversationId) return { ok: false, detail: 'no conversation to remind into' };
    const fireAt = new Date(now.getTime() + action.params.inHours * 3_600_000);
    const name = `daydream:${opts.key}`.slice(0, 120);
    await db
      .insert(scheduledCallbacks)
      .values({
        name,
        description: `daydream reminder: ${action.params.text.slice(0, 80)}`,
        fireAt,
        kind: 'reply',
        conversationId,
        payload: { text: `⏰ ${action.params.text}`, notifyWhatsApp: true },
        source: 'system',
      })
      .onConflictDoUpdate({
        target: scheduledCallbacks.name,
        set: {
          fireAt,
          payload: { text: `⏰ ${action.params.text}`, notifyWhatsApp: true },
          status: 'pending',
          updatedAt: now,
        },
      });
    return { ok: true, detail: `reminder set for ${fireAt.toISOString()}` };
  }
  return { ok: false, detail: `unhandled kind ${action.kind}` };
}
