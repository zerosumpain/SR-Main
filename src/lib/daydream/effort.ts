// src/lib/daydream/effort.ts
//
// The effort dial — PURE. Three shares, 0..100 each, resolved into the
// per-activity numbers the engine already reads. The stored setting is in
// `effort.server.ts`; the activities apply the resolved values through
// `applyEffort`, where an EXPLICIT key on the heartbeat row's config still
// wins (a row someone tuned by hand is a decision, not a default).
//
// Why three shares and not one knob: the owner's ask (2026-09-02) was to
// "tailor how much time is spent on identifying new correlates, testing them,
// and proposing them to the user". Those are three different bills —
// discovery is mostly free statistics plus one proposer call, testing is the
// xhigh reviewer, proposing is the composer — and one knob could not favour
// one over another. Spend stays under the Codex caps in `budget.ts`; the dial
// decides what the allowance is spent ON, never how much of it exists.

export interface Effort {
  /** Finding new correlates: proposals, musings, leads, sweep breadth, lookups. */
  discover: number;
  /** Checking them: reviewer throughput, verify passes, memory backfill. */
  test: number;
  /** Saying them: candidates per compose pass. */
  propose: number;
}

export const DEFAULT_EFFORT: Effort = { discover: 50, test: 50, propose: 50 };

export function clampEffort(raw: Partial<Effort> | null | undefined): Effort {
  const one = (v: unknown, d: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d;
    return Math.max(0, Math.min(100, n));
  };
  return {
    discover: one(raw?.discover, DEFAULT_EFFORT.discover),
    test: one(raw?.test, DEFAULT_EFFORT.test),
    propose: one(raw?.propose, DEFAULT_EFFORT.propose),
  };
}

/** Piecewise map of a 0..100 share onto an integer range: 0 → `lo`, 50 →
 *  `mid` (the number the engine shipped with), 100 → `hi`. */
function scale(share: number, lo: number, mid: number, hi: number): number {
  const s = Math.max(0, Math.min(100, share));
  return Math.round(s <= 50 ? lo + ((mid - lo) * s) / 50 : mid + ((hi - mid) * (s - 50)) / 50);
}

export interface ResolvedEffort {
  hypothesise: { maxProposals: number };
  /** How many capabilities one appetite scan may admit. */
  appetite: { maxLeads: number };
  ponder: { maxMusings: number; maxLeads: number; lookupBudget: number };
  sweep: { maxSignals: number };
  explore: { maxLeads: number };
  review: { maxPerRun: number; backfillPerRun: number };
  compose: {
    /** Added to the budget plan's `maxCandidates`. */
    extraCandidates: number;
    /** Whether a verify pass is worth its call at this share. */
    verify: boolean;
  };
}

/**
 * The numbers. At 50 every value is what the engine shipped with, so a dial
 * nobody has touched changes nothing; the ranges are what production has
 * shown to be safe at the top and useful at the bottom.
 */
export function resolveEffort(raw: Partial<Effort> | null | undefined): ResolvedEffort {
  const e = clampEffort(raw);
  return {
    hypothesise: { maxProposals: scale(e.discover, 1, 4, 8) },
    // Under `discover`, because proposing a capability is the same activity as
    // proposing a correlate — finding something the engine did not have. The
    // ceiling is low on purpose: the lanes downstream build at most a couple
    // of things a night, and a ledger that fills faster than it drains is the
    // failure `improvement_backlog` already lived through (410 open items).
    appetite: { maxLeads: scale(e.discover, 1, 3, 5) },
    ponder: {
      maxMusings: scale(e.discover, 2, 4, 6),
      maxLeads: scale(e.discover, 1, 2, 4),
      lookupBudget: scale(e.discover, 2, 6, 10),
    },
    sweep: { maxSignals: scale(e.discover, 60, 120, 240) },
    explore: { maxLeads: scale(e.discover, 1, 3, 6) },
    review: { maxPerRun: scale(e.test, 1, 4, 8), backfillPerRun: scale(e.test, 4, 10, 20) },
    compose: { extraCandidates: e.propose >= 75 ? 2 : e.propose >= 50 ? 1 : 0, verify: e.test >= 25 },
  };
}

/**
 * Apply resolved values beneath a heartbeat row's explicit config.
 *
 * A key present on `explicit` wins — the row is editable by hand and a value
 * someone typed there is a decision. The dial fills in the rest.
 */
export function applyEffort<T extends Record<string, unknown>>(
  explicit: Record<string, unknown> | null | undefined,
  fromEffort: T,
): T {
  const out = { ...fromEffort } as Record<string, unknown>;
  for (const k of Object.keys(fromEffort)) {
    if (explicit && explicit[k] !== undefined && explicit[k] !== null) out[k] = explicit[k];
  }
  return out as T;
}

/** One line per share, for the engine room and the pulse. */
export function describeEffort(raw: Partial<Effort> | null | undefined): string[] {
  const e = clampEffort(raw);
  const r = resolveEffort(e);
  return [
    `discover ${e.discover}: ${r.hypothesise.maxProposals} proposals, ${r.ponder.maxMusings} musings, ${r.ponder.maxLeads} leads, ${r.sweep.maxSignals} signals swept, ${r.explore.maxLeads} leads explored, ${r.ponder.lookupBudget} lookups`,
    `test ${e.test}: ${r.review.maxPerRun} reviews a pass, ${r.review.backfillPerRun} rulings remembered, verify ${r.compose.verify ? 'on' : 'off'}`,
    `propose ${e.propose}: ${r.compose.extraCandidates ? `+${r.compose.extraCandidates}` : 'no extra'} candidates a compose pass`,
  ];
}
