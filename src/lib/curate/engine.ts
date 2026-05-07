// src/lib/curate/engine.ts
//
// Phase state machine for the curate flow.
// Phase orchestrators (runScopeChat, runDiscovery, etc.) are wired in a later task.

import { getSession, updateSession } from './session-store';

// ── Allowed transition graph ────────────────────────────────────────────

const TRANSITIONS: Record<string, string[]> = {
  scoping:             ['discovering', 'aborted'],
  discovering:         ['awaiting-approval', 'error', 'aborted'],
  'awaiting-approval': ['generating', 'discovering', 'aborted'],
  generating:          ['live-testing', 'error'],
  'live-testing':      ['awaiting-promotion', 'generating', 'aborted'],
  'awaiting-promotion': ['promoting', 'aborted'],
  promoting:           ['promoted', 'error'],
  // Terminal statuses — no further transitions allowed.
  promoted:            [],
  aborted:             [],
  error:               [],
  ended:               [],
};

/**
 * Returns the list of statuses this session can legally transition to from
 * `currentStatus`. Returns [] for unknown statuses.
 */
export function getAllowedTransitions(currentStatus: string): string[] {
  return TRANSITIONS[currentStatus] ?? [];
}

// ── Log entry type ──────────────────────────────────────────────────────

interface TransitionLogEntry {
  from: string;
  to: string;
  at: string; // ISO timestamp
}

// ── transitionStatus ────────────────────────────────────────────────────

/**
 * Validates that `to` is an allowed target from `from`, then persists the
 * new status and appends a transition entry to `iterationLog`.
 *
 * Throws if:
 * - the session is not found
 * - the transition is not in the allowed graph
 */
export async function transitionStatus(
  sessionId: string,
  from: string,
  to: string,
): Promise<void> {
  const allowed = getAllowedTransitions(from);
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid curate-session transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`,
    );
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Curate session not found: ${sessionId}`);
  }

  const existing = (session.iterationLog ?? []) as unknown[];
  const entry: TransitionLogEntry = {
    from,
    to,
    at: new Date().toISOString(),
  };

  await updateSession(sessionId, {
    status: to,
    iterationLog: [...existing, entry],
  });
}
