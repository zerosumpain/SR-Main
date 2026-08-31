// src/lib/daydream/health-quality.ts
//
// A reading that cannot be true must not become a suggestion.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// A feed card told John he had slept 464,018 hours. The reviewer caught it —
// "physiologically impossible, so the recorded duration should not be trusted"
// — which is the review stage working exactly as designed, and is also far too
// late. By then the number had already been through a detector, been written
// into a thought, been carded to the ponder model, and reached the rule engine.
// Three of those four had no idea anything was wrong.
//
// The cause was units, not arithmetic. `whoop_sleep.total_in_bed` is
// MILLISECONDS — the schema says so, directly above the column — and
// `snapshot.ts` assigned it to a field called `durationMins`. 27,841,092 ms is
// 7h44m of sleep and 27,841,092 "minutes" is 464,018 hours, which is how a
// perfectly ordinary night became a number with six digits in front of the
// decimal point.
//
// ── Why this module exists rather than one more conversion ─────────────────
//
// The features pipeline already had both halves of the answer:
// `features/build.ts` converts the milliseconds, and `features/normalise.ts`
// runs every value through a `plausible()` tripwire whose comment is worth
// repeating — "record nothing rather than feed a 100x error into a correlation
// and let it come back as a confident finding". The snapshot pipeline, which is
// what detectors, the pack and the rules actually read, had neither.
//
// So this is the tripwire for the second pipeline, sharing the FIRST one's
// bounds rather than declaring a rival set. Two tables of what counts as a
// possible night's sleep is how they come to disagree.
//
// ── Flagged, not silently dropped ──────────────────────────────────────────
//
// `plausible()` returns null and says nothing, which is right where it is used
// (a missing feature row is ordinary). Here it is not enough: a health source
// that has started emitting impossible numbers is a FAULT, and a fault that
// only ever manifests as absence looks exactly like a quiet week. So a rejected
// reading is reported on the snapshot's source list — the same list the Engine
// tab renders — and files itself as a self-improvement item, because the fix is
// nearly always a unit conversion in one place and that is a job the engine can
// be asked to do.

import { PLAUSIBLE, plausible } from './features/normalise';
import { errMsg } from './types';

/** Whoop stores every duration in milliseconds, whatever the column is called. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds to whole minutes. Named for the unit it consumes, because the
 *  entire bug was a field named for the unit it did not. */
export function msToMinutes(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round(ms / MS_PER_MINUTE);
}

export interface Reading {
  /** The value to use, or null when it cannot be true. */
  value: number | null;
  /** Why it was rejected, in words, or null when it was fine. Reported on the
   *  snapshot's source list rather than swallowed. */
  problem: string | null;
}

/**
 * Accept a reading, or reject it with a reason.
 *
 * Bounds come from `PLAUSIBLE` in features/normalise — one table, shared.
 * A key with no bounds is passed through unchanged, exactly as `plausible`
 * does, so this can be adopted key by key without a big-bang edit.
 */
export function checkReading(key: string, value: number | null | undefined): Reading {
  const v = value == null || !Number.isFinite(value) ? null : value;
  if (v == null) return { value: null, problem: null };

  const kept = plausible(key, v);
  if (kept != null) return { value: kept, problem: null };

  const b = PLAUSIBLE[key];
  return {
    value: null,
    problem: b
      ? `${key} was ${v.toLocaleString('en-GB')}, outside the possible range ${b.lo}–${b.hi} — not used`
      : `${key} was ${v.toLocaleString('en-GB')}, which is not a usable number — not used`,
  };
}

/**
 * Ask the self-improvement engine to go and fix the source of a bad reading.
 *
 * Only ever called from the rejected branch, so in a healthy system this never
 * runs at all. `addIdeas` is idempotent per slug and carries its own
 * twelve-a-night cap, so a fault that persists produces ONE backlog item rather
 * than one every ten minutes.
 *
 * Never throws. A backlog that is unreachable must not take the snapshot down
 * with it — the reading has already been rejected by the time we get here, and
 * that is the part that protects the owner.
 */
export async function fileReadingFault(key: string, problem: string): Promise<boolean> {
  try {
    const { addIdeas } = await import('$lib/selfimprove/backlog');
    const added = await addIdeas([
      {
        title: `Health reading "${key}" is arriving impossible`,
        detail: [
          `The daydream snapshot rejected a ${key} reading: ${problem}.`,
          '',
          'This is almost always a UNIT mismatch rather than bad data at the',
          'source. The known example: whoop_sleep.total_in_bed is milliseconds',
          '(the schema says so directly above the column) and was being assigned',
          'to a field called durationMins, turning 7h44m into 464,018 hours.',
          '',
          'Find where this value is read, check the stored unit against the field',
          'name it lands in, and convert at the point of read. Bounds live in one',
          'place: PLAUSIBLE in src/lib/daydream/features/normalise.ts.',
        ].join('\n'),
        kind: 'feature',
        priority: 2,
      },
    ]);
    return added.length > 0;
  } catch (err) {
    console.warn(`[daydream] could not file a reading fault for ${key}:`, errMsg(err));
    return false;
  }
}
