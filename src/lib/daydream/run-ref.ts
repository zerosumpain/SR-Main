// src/lib/daydream/run-ref.ts
//
// The read-side run ledger: a heartbeat pulse → the run record it produced.
//
// `heartbeat_pulses` is the canonical "a scheduled run happened" row, but the
// two engines that run under the heartbeat keep their real record elsewhere —
// `improvement_runs` and `doctor_runs`, updated live per phase and polled by
// their own pages. The pulse already carried the join (`details.runId`); what
// it did not carry was WHICH ledger the id belongs to, so a reader had to know
// that from the activity name. `details.runRef` says it outright.
//
// Why this lives in $lib/daydream and not $lib/heartbeat/types.ts: the reader
// is used by `rooms/overnight.server.ts`, and `heartbeat -> daydream` is an
// existing edge. Putting it in heartbeat would add `daydream -> heartbeat`, a
// new mutual pair that check-module-boundaries rejects. Nothing here imports
// anything, so both sides can use it.
//
// Builds are deliberately NOT here: they have their own scheduler and their own
// run row, and never write a pulse to link from.

export type RunKind = 'improvement' | 'doctor';

/** What a pulse's `details.runRef` holds. */
export interface RunRef {
  kind: RunKind;
  id: string;
}

export function runRef(kind: RunKind, id: string): RunRef {
  return { kind, id };
}

/**
 * Pulses written before `runRef` existed carry only `runId`. Pulses are pruned
 * at 14 days, so this fallback is needed for two weeks after deploy and is
 * harmless after that.
 */
const KIND_BY_ACTIVITY: Record<string, RunKind> = {
  'daydream-improve': 'improvement',
  'daydream-doctor': 'doctor',
};

/**
 * Where each ledger shows a run. No per-run page exists; each run is a row on
 * its ledger, anchored `#run-<id>`.
 */
const LEDGER: Record<RunKind, string> = {
  improvement: '/jkai/daydreams/improvement',
  doctor: '/jkai/daydreams/doctor',
};

function isKind(v: unknown): v is RunKind {
  return v === 'improvement' || v === 'doctor';
}

/** Read a pulse's run reference: the new `runRef`, else the old `runId` + the activity name. */
export function readRunRef(details: unknown, activity?: string | null): RunRef | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;

  const ref = d.runRef as Record<string, unknown> | undefined;
  if (ref && typeof ref === 'object' && isKind(ref.kind) && typeof ref.id === 'string' && ref.id) {
    return { kind: ref.kind, id: ref.id };
  }

  const kind = activity ? KIND_BY_ACTIVITY[activity] : undefined;
  if (kind && typeof d.runId === 'string' && d.runId) return { kind, id: d.runId };
  return null;
}

/** The URL of the run record a pulse produced, or null when it names none. */
export function runRefHref(details: unknown, activity?: string | null): string | null {
  const ref = readRunRef(details, activity);
  if (!ref) return null;
  return `${LEDGER[ref.kind]}#run-${encodeURIComponent(ref.id)}`;
}

/**
 * The run a ledger page was linked to: `#run-<id>` → `<id>`, else null. The
 * ledgers keep their run lists collapsed, so the page uses this to open the
 * row the link named rather than landing on a heading.
 */
export function runIdFromHash(hash: string | null | undefined): string | null {
  if (!hash || !hash.startsWith('#run-')) return null;
  try {
    return decodeURIComponent(hash.slice('#run-'.length)) || null;
  } catch {
    return null;
  }
}
