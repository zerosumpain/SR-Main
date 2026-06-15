// src/lib/canvas/intelligence/desk/phases.ts
// Pure helpers for the ordered research phase model.
import type { DeskStatus } from './deskControls';

export type PhaseState = 'done' | 'current' | 'upcoming';

export interface PhaseInfo {
  key: DeskStatus;
  label: string;
  shortLabel: string;
}

/** Canonical ordered phases (excludes terminal non-phase statuses draft/complete/failed). */
export const PHASES: PhaseInfo[] = [
  { key: 'phase1', label: 'Lead Generation', shortLabel: 'Leads' },
  { key: 'phase2', label: 'Deep Research',   shortLabel: 'Research' },
  { key: 'phase3', label: 'Red Teaming',     shortLabel: 'Red Team' },
  { key: 'post_processing', label: 'Synthesis', shortLabel: 'Synthesis' },
];

/**
 * Returns the state of each phase (done / current / upcoming) for the given
 * session status.
 *
 * Rules:
 *  - draft         → all upcoming
 *  - phase1..post  → phases before current = done, current phase = current, rest = upcoming
 *  - complete      → all done
 *  - failed        → phases before the current position = done, the phase that
 *                    was running = current (so the failure point is obvious), rest = upcoming
 *
 * For `failed` we treat it the same as "current phase still highlighted" because
 * we can't know exactly which phase failed without extra context; we keep the
 * stepper at the position it was at when it failed. Callers that have a separate
 * `failedAt` value can compute their own split using the phase index.
 */
export function phaseStateFor(status: DeskStatus): Record<DeskStatus, PhaseState> {
  const idx = PHASES.findIndex((p) => p.key === status);

  return Object.fromEntries(
    PHASES.map((p, i) => {
      let state: PhaseState;
      if (status === 'draft') {
        state = 'upcoming';
      } else if (status === 'complete') {
        state = 'done';
      } else if (idx === -1) {
        // Unknown status — treat everything as upcoming
        state = 'upcoming';
      } else {
        // Running or failed at a known phase position
        if (i < idx) state = 'done';
        else if (i === idx) state = 'current';
        else state = 'upcoming';
      }
      return [p.key, state];
    })
  ) as Record<DeskStatus, PhaseState>;
}

/**
 * Returns the human label of the phase that a skip would advance to,
 * or null when there is no next phase (post_processing is the last skippable
 * step; complete / draft / failed have no next phase).
 *
 * Note: post_processing itself cannot be skipped (the worker guards it),
 * but we still report what it would advance to (complete) so the button
 * can be disabled correctly — callers should use `controlState.canPause`
 * to gate the skip action.
 */
export function nextPhaseLabel(status: DeskStatus): string | null {
  const idx = PHASES.findIndex((p) => p.key === status);
  if (idx === -1) return null; // draft / complete / failed
  const next = PHASES[idx + 1];
  if (!next) return null;      // already at last phase (post_processing)
  return next.label;
}
