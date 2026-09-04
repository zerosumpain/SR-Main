// Five things you could do, ranked, with what each one costs.
//
// The instrument deck says where the body is. This says what to do about it,
// and — the part that makes it worth reading — what each option costs and what
// it puts at risk. The second column is the one that decides.
//
// Everything here is a RULE over numbers the deck already computed. There is no
// model in this file and there never will be: a recommendation that cannot be
// traced back to a threshold is an opinion, and the page already carries enough
// of those in the reader.
//
// The composition rules, in one place:
//
//  * A move is only a candidate if the instruments behind it are READABLE and
//    actually OFF TARGET. An insufficient MetricResult carries a confident zero
//    struct, so every read goes through `usable()` first.
//  * Leverage is `2 + (instruments it moves)`, capped at 5. Three instruments
//    is the maximum any single habit reaches here, so three fills the meter.
//    Gated and behavioural moves take a fixed 3, the do-nothing baseline a 1.
//  * The list is sorted by leverage, descending, and the sort is STABLE — ties
//    fall back to the declaration order below, which is the order of how
//    directly a move touches a measured number.
//  * "Do nothing new" is always last and always present, unless an instrument
//    is genuinely in a danger band, in which case holding is not honest.

import type { MetricResult } from './analytics/types';
import { ACWR_BANDS, type ACWRResult } from './analytics/acwr';
import type { MonotonyResult } from './analytics/monotony';
import {
  POLARISED_EASY_PCT,
  POLARISED_HARD_PCT,
  type PolarisedResult,
} from './analytics/polarised';
import { SRI_TARGET } from './analytics/sri';
import type { CircadianResult } from './analytics/circadian';
import type { AutonomicResult } from './analytics/autonomic-balance';
import {
  SLEEP_BALANCE_SHORTFALL_MIN,
  STRAIN_BALANCE_FLAG,
  type RecoveryDebtResult,
} from './analytics/recovery-debt';
import type { VO2Result } from './analytics/vo2max-percentile';

export const MAX_MOVES = 5;

export type MoveId =
  | 'sleep-window'
  | 'long-easy-day'
  | 'polarised-mix'
  | 'book-big-day'
  | 'hold-and-watch';

export interface Move {
  id: MoveId;
  /** 1-based, contiguous, assigned after the sort. */
  rank: number;
  title: string;
  rationale: string;
  buys: string[];
  costs: string[];
  /** Filled bars out of five. */
  leverage: number;
  /** What the meter is measuring — "3 INSTRUMENTS", "GATED ON 01+02", … */
  leverageLabel: string;
  /** Accent for a move that is free to start; muted for gated or behavioural. */
  tone: 'accent' | 'muted';
  /** The deck panels this move actually moves. Drives `leverage`. */
  instruments: string[];
}

export interface MovesInput {
  readiness: { score: number; label: string } | null;
  acwr: MetricResult<ACWRResult> | null;
  monotony: MetricResult<MonotonyResult> | null;
  polarised: MetricResult<PolarisedResult> | null;
  /** Phillips 2017 sleep regularity index, 0–100. */
  sri: MetricResult<number> | null;
  circadian: MetricResult<CircadianResult> | null;
  autonomic: MetricResult<AutonomicResult> | null;
  recoveryDebt: MetricResult<RecoveryDebtResult> | null;
  /** Beats per kilometre: the 7-day mean against the 28-day baseline. Lower is better. */
  efficiency: { latest7: number | null; baseline28: number | null } | null;
  vo2: MetricResult<VO2Result> | null;
  /** Last COMPLETE week against the twelve-week median, in kilometres. */
  volume: { weekKm: number; medianKm: number } | null;
}

/** Circadian drift past an hour is flagged — the same edge `computeCircadianAlignment` uses. */
const CIRCADIAN_FLAG_HOURS = 1;
/** Where the long-easy-day move is aiming the ratio: just inside the building band. */
const ACWR_TARGET = ACWR_BANDS.undertraining + 0.05;
/** A week under this share of its own median is a hole worth filling. */
const VOLUME_LOW_PCT = 0.8;

/** Moves that must have run before a hard-effort block is a good idea. */
const MIX_GATES: MoveId[] = ['sleep-window', 'long-easy-day'];

export function computeMoves(input: MovesInput): Move[] {
  const candidates = [
    sleepWindow(input),
    longEasyDay(input),
    polarisedMix(input),
    bookBigDay(input),
  ].filter((m): m is Draft => m != null);

  // The gate, applied BEFORE the sort so a gated move ranks where its reduced
  // leverage puts it. Hard work on short sleep is how this list restarts at the
  // top, so the mix move waits behind whichever of its gates are still open.
  const mix = candidates.find((m) => m.id === 'polarised-mix');
  const gates = candidates.filter((m) => MIX_GATES.includes(m.id)).map((m) => m.id);
  if (mix && gates.length) {
    mix.gatedBy = gates;
    mix.leverage = 3;
    mix.tone = 'muted';
    mix.costs.push(
      `Should not start before ${gates.length === 1 ? 'the move above it has' : 'the moves above it have'} run four weeks.`,
    );
  }

  const hold = holdAndWatch(input, candidates);
  const all = hold ? [...candidates, hold] : candidates;

  // Stable sort: ties keep the declaration order above, which runs from the
  // most directly measurable move to the least.
  const ranked = [...all].sort((a, b) => b.leverage - a.leverage).slice(0, MAX_MOVES);
  const moves = ranked.map((m, i) => ({ ...m, rank: i + 1 }));

  // The gate's label names the ranks it waits on, so it can only be written
  // once the ranks exist: "GATED ON 01+02".
  for (const m of moves) {
    if (!m.gatedBy?.length) continue;
    const on = m.gatedBy
      .map((id) => moves.find((other) => other.id === id)?.rank)
      .filter((r): r is number => r != null)
      .map((r) => String(r).padStart(2, '0'));
    if (on.length) m.leverageLabel = `GATED ON ${on.join('+')}`;
  }
  return moves.map(({ gatedBy: _gatedBy, ...m }) => m);
}

type Draft = Omit<Move, 'rank'> & { gatedBy?: MoveId[] };

// ——— 01 · the sleep window ————————————————————————————————————————

function sleepWindow(i: MovesInput): Draft | null {
  const instruments: string[] = [];
  const clauses: string[] = [];
  const buys: string[] = [];

  if (usable(i.sri) && i.sri.value < SRI_TARGET) {
    instruments.push('SRI');
    clauses.push(`SRI ${Math.round(i.sri.value)}`);
    buys.push(`Sleep regularity ${Math.round(i.sri.value)} toward the ${SRI_TARGET} target.`);
  }
  if (usable(i.circadian) && Math.abs(i.circadian.value.driftHours) >= CIRCADIAN_FLAG_HOURS) {
    instruments.push('CIRCADIAN DRIFT');
    clauses.push(`circadian drift ${signed(i.circadian.value.driftHours, 1)}h`);
    buys.push(`Pulls the sleep midpoint back inside the ${CIRCADIAN_FLAG_HOURS}-hour flag.`);
  }
  if (
    usable(i.recoveryDebt) &&
    i.recoveryDebt.value.averageBalanceMin < -SLEEP_BALANCE_SHORTFALL_MIN
  ) {
    const shortfall = Math.round(Math.abs(i.recoveryDebt.value.averageBalanceMin));
    instruments.push('SLEEP BALANCE');
    clauses.push(`a seven-night balance ${shortfall} minutes short per night`);
    buys.push('Brings the seven-night sleep balance back toward even.');
  }
  if (!instruments.length) return null;

  const tail =
    instruments.length >= 3
      ? ' — the only move on this page that touches three instruments at once.'
      : instruments.length === 2
        ? ' — one habit against two instruments.'
        : '.';

  const costs = ['Evening time, every night.'];
  if (instruments.includes('SRI')) {
    costs.push('Fails quietly if wake time is not also stable — SRI counts both ends.');
  }
  if (usable(i.autonomic) && i.autonomic.value.hrvZ < 0) {
    buys.push(
      `HRV is ${Math.abs(i.autonomic.value.hrvZ).toFixed(2)} standard deviations under its own baseline; this is the input that moves it.`,
    );
  }

  return {
    id: 'sleep-window',
    title: 'FIXED LIGHTS-OUT WINDOW',
    rationale: `A 30-minute bedtime window, five nights in seven. Attacks ${sentence(clauses)} with one habit${tail}`,
    buys,
    costs,
    ...meter(instruments),
    instruments,
  };
}

// ——— 02 · one long easy day ——————————————————————————————————————

function longEasyDay(i: MovesInput): Draft | null {
  const instruments: string[] = [];
  const clauses: string[] = [];
  const buys: string[] = [];

  const ratio = usable(i.acwr) ? i.acwr.value.ratio : null;
  if (ratio != null && ratio < ACWR_BANDS.undertraining) {
    instruments.push('ACWR');
    clauses.push(`pulls ACWR back off the ${i.acwr!.value.zone} edge at ${ratio.toFixed(2)}`);
    buys.push(`ACWR ${ratio.toFixed(2)}→${ACWR_TARGET.toFixed(2)}, into the band where fitness builds.`);
  }
  const vol = i.volume;
  if (vol && vol.medianKm > 0 && vol.weekKm < vol.medianKm * VOLUME_LOW_PCT) {
    instruments.push('WEEKLY VOLUME');
    clauses.unshift(
      `takes weekly volume from ${trim(vol.weekKm)} km toward the ${trim(vol.medianKm)} km median`,
    );
    // Every move on this page states what it buys — the second column is the
    // one that decides. This branch filled the instruments and the rationale
    // and pushed nothing here, so on an ACWR-optimal, low-volume week the card
    // shipped with an empty BUYS paragraph under the heading.
    buys.push(
      `Weekly volume ${trim(vol.weekKm)}→${trim(vol.medianKm)} km, back on the twelve-week median.`,
    );
  }
  if (!instruments.length) return null;

  if (usable(i.vo2) && i.vo2.value.trendSlopePerMonth < 0) {
    buys.push(
      `Halts a VO₂max slope of ${signed(i.vo2.value.trendSlopePerMonth, 2)} a month.`,
    );
  }
  if (usable(i.polarised) && i.polarised.value.easyPct >= POLARISED_EASY_PCT) {
    buys.push(`Keeps the easy share above ${POLARISED_EASY_PCT}%.`);
  }

  const costs = ['Two to three hours of calendar a week.'];
  if (
    usable(i.recoveryDebt) &&
    i.recoveryDebt.value.averageBalanceMin < -SLEEP_BALANCE_SHORTFALL_MIN
  ) {
    costs.push('Adding volume while the seven-night sleep balance is short can widen the nightly gap.');
  }

  return {
    id: 'long-easy-day',
    title: 'ONE LONG EASY DAY A WEEK',
    rationale: `12–15 km at hike heart rate. It ${sentence(clauses)}. Deliberately dull — the shape a resting-heart-rate floor is built on.`,
    buys,
    costs,
    ...meter(instruments),
    instruments,
  };
}

// ——— 03 · tip the mix ————————————————————————————————————————————

function polarisedMix(i: MovesInput): Draft | null {
  if (!usable(i.polarised)) return null;
  const p = i.polarised.value;
  if (p.verdict === 'polarised' || p.verdict === 'insufficient-volume') return null;

  const instruments = ['INTENSITY MIX'];
  const buys = [
    'The strongest single stimulus for VO₂max there is.',
    'Doubles as segment PB attempts, so it is measurable.',
  ];
  const costs = ['The highest injury and HRV cost on this list.'];

  const rationale =
    p.verdict === 'junk-middle'
      ? `Add one genuinely hard effort a week — a targeted segment, not a race. ${Math.round(p.midPct)}% of the time is being spent in the middle zones, which is the real trap; this takes the hard share from ${Math.round(p.hardPct)}% to the ${POLARISED_HARD_PCT}% a polarised verdict needs.`
      : `Add one genuinely hard effort a week — a targeted segment, not a race. Takes the hard share from ${Math.round(p.hardPct)}% to the ${POLARISED_HARD_PCT}% that turns the ${p.verdict} verdict polarised, without touching the ${Math.round(p.easyPct)}% easy share.`;

  return { id: 'polarised-mix', title: 'TIP THE MIX TO POLARISED', rationale, buys, costs, ...meter(instruments), instruments };
}

// ——— 04 · book one big day ————————————————————————————————————————

function bookBigDay(i: MovesInput): Draft | null {
  // Behavioural, so it is only worth listing when the thing it fixes — a
  // horizon — is measurably missing: thin volume, or a base going backwards.
  const vol = i.volume;
  const volumeThin = !!vol && vol.medianKm > 0 && vol.weekKm < vol.medianKm * VOLUME_LOW_PCT;
  const ratioThin = usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.undertraining;
  if (!volumeThin && !ratioThin) return null;

  const why = volumeThin
    ? `Nothing on the calendar is why the volume drifted to ${trim(vol!.weekKm)} km against a ${trim(vol!.medianKm)} km median.`
    : `Nothing on the calendar is why the acute load fell to ${i.acwr!.value.ratio.toFixed(2)} of its own base.`;

  return {
    id: 'book-big-day',
    title: 'BOOK ONE BIG DAY',
    rationale: `A named objective with a date on it. ${why} A booked date does the motivational work no dashboard can.`,
    buys: [
      'Turns the long easy day from discipline into preparation.',
      'Fixes the horizon every other number is measured against.',
    ],
    costs: [
      'A deadline can override the readiness gates.',
      'Commit to the date, not to going regardless of what the panel says.',
    ],
    leverage: 3,
    leverageLabel: 'BEHAVIOURAL',
    tone: 'muted',
    instruments: [],
  };
}

// ——— 05 · do nothing new ——————————————————————————————————————————

function holdAndWatch(i: MovesInput, others: Draft[]): Draft | null {
  // Holding is only honest while nothing is actually in a danger band. It is
  // also pointless with no alternative to hold against.
  if (!others.length) return null;
  if (usable(i.acwr) && i.acwr.value.zone === 'danger') return null;
  if (usable(i.monotony) && i.monotony.value.band === 'high') return null;
  if (usable(i.recoveryDebt) && i.recoveryDebt.value.strainRecoveryBalance > STRAIN_BALANCE_FLAG) {
    return null;
  }

  const good: string[] = [];
  if (usable(i.vo2) && (i.vo2.value.band === 'excellent' || i.vo2.value.band === 'superior')) {
    good.push(`cardio fitness reads ${i.vo2.value.band} at the ${Math.round(i.vo2.value.percentile)}th percentile`);
  }
  if (i.readiness) good.push(`readiness reads ${i.readiness.label.toLowerCase()} at ${Math.round(i.readiness.score)}`);
  if (usable(i.monotony) && i.monotony.value.band !== 'high') {
    good.push(`the week has genuine hard/easy shape at a monotony of ${i.monotony.value.monotony.toFixed(1)}`);
  }

  const costs: string[] = ['Zero cost, and a slope: doing nothing is still a decision.'];
  if (usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.undertraining) {
    costs.push(`ACWR is already at ${i.acwr.value.ratio.toFixed(2)} and heading for the detraining edge.`);
  }
  if (usable(i.vo2) && i.vo2.value.trendSlopePerMonth < 0) {
    costs.push(
      `VO₂max loses ${(Math.abs(i.vo2.value.trendSlopePerMonth) * 12).toFixed(1)} in a year at the current slope.`,
    );
  }

  const opening = good.length
    ? `The honest baseline this list needs: ${sentence(good)}, and no instrument is in a danger band.`
    : 'The honest baseline this list needs — no instrument is in a danger band.';

  return {
    id: 'hold-and-watch',
    title: 'DO NOTHING NEW · HOLD AND WATCH',
    rationale: `${opening} A quarter of holding is a legitimate choice, not a failure.`,
    buys: ['Zero cost.', 'Keeps the tripwires as the whole system until something actually trips.'],
    costs,
    leverage: 1,
    leverageLabel: 'BASELINE',
    tone: 'muted',
    instruments: [],
  };
}

// ——— shared ————————————————————————————————————————————————————

/** Leverage, its label and its tone, from the instruments a move actually moves. */
function meter(instruments: string[]): Pick<Move, 'leverage' | 'leverageLabel' | 'tone'> {
  const n = instruments.length;
  return {
    leverage: Math.max(1, Math.min(5, 2 + n)),
    leverageLabel: `${n} INSTRUMENT${n === 1 ? '' : 'S'}`,
    tone: 'accent',
  };
}

function usable<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

function sentence(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (!kept.length) return '';
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

function signed(v: number, dp: number): string {
  return v > 0 ? `+${v.toFixed(dp)}` : `−${Math.abs(v).toFixed(dp)}`;
}

/** 7.7 stays 7.7; 20.0 becomes 20. */
function trim(km: number): string {
  const s = km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
