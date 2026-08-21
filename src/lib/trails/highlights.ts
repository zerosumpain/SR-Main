// What was excellent about that one?
//
// Every outing in the list carries a badge saying why it was worth doing —
// a segment PB, an all-time record, the hottest ride of the year, the earliest
// start, the fastest back-to-back pair. This module is the whole computation,
// and it is PURE: it takes the corpus in and hands a ranked list of highlights
// back, so it can be tested against production numbers without a database.
//
// Three rules the ranking must keep, all of them learned the hard way:
//
//  1. EFFICIENCY FACTOR AND BEATS-PER-KM COMPARE ONLY WITHIN PACE SPORTS.
//     A ride's EF sits around 4 where a run's sits near 1, so a single
//     all-sports EF ranking is just a list of bike rides. The segments explorer
//     already partitions this way; so does everything here.
//
//  2. ACTIVITY-LEVEL RECORDS PARTITION BY EFFECTIVE TYPE. "Longest ever" means
//     longest walk or longest ride, never longest anything — and the type read
//     is the owner's correction when there is one.
//
//  3. EVERY ACTIVITY GETS AT LEAST ONE HIGHLIGHT. A list where some rows have a
//     badge and some have a blank is worse than no badges. `percentile` and
//     `first_since` are the guaranteed floors and a test asserts the invariant.

import { isPaceSport } from './format';
import { gradeDifficulty } from './difficulty';

export interface ActivityFacts {
  id: string;
  /** ALREADY resolved through effectiveType() — the override, not the raw column. */
  activityType: string;
  name: string;
  startDate: number;
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string | null;
  /** Minutes past local midnight, or null when the local string was unparseable. */
  minutesOfDay: number | null;
  distanceM: number | null;
  durationS: number;
  movingS: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  avgPaceSPerKm: number | null;
  activeEnergyKj: number | null;
  tempC: number | null;
  /** null means "unknown", which is not the same as "outdoors". */
  indoor: boolean | null;
  excludedFromSegments: boolean;
}

export interface EffortFacts {
  activityId: string;
  segmentId: number;
  segmentName: string;
  segmentActivityType: string;
  lapIndex: number;
  durationS: number;
  paceSPerKm: number | null;
  efficiencyFactor: number | null;
  beatsPerKm: number | null;
  avgHeartrate: number | null;
  /** Seconds from the start of the parent activity. */
  startS: number;
  endS: number;
}

export type HighlightScope = 'segment' | 'activity' | 'environment' | 'rhythm';

export interface Highlight {
  kind: string;
  scope: HighlightScope;
  /** 1-based placing inside its comparison set, or null for the non-ranked kinds. */
  rank: number | null;
  outOf: number | null;
  /** Short enough for a badge: "2nd fastest". */
  label: string;
  /** The context that makes the label mean something. */
  detail: string;
  /** Higher leads. The row shows highlights[0]. */
  weight: number;
  segmentId?: number;
  segmentName?: string;
}

// ——— small helpers ————————————————————————————————————————————————

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function km(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  return `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km`;
}

function hhmm(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clock(minutesOfDay: number): string {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TYPE_PLURAL: Record<string, string> = {
  run: 'runs',
  trail_run: 'trail runs',
  ride: 'rides',
  mtb: 'MTB rides',
  hike: 'hikes',
  walk: 'walks',
  swim: 'swims',
  other: 'sessions',
};

const TYPE_SINGULAR: Record<string, string> = {
  run: 'run',
  trail_run: 'trail run',
  ride: 'ride',
  mtb: 'MTB ride',
  hike: 'hike',
  walk: 'walk',
  swim: 'swim',
  other: 'session',
};

export function typeNoun(type: string, plural = false): string {
  const map = plural ? TYPE_PLURAL : TYPE_SINGULAR;
  return map[type] ?? type.replace(/_/g, ' ');
}

/**
 * Rank a set of keyed values, best first.
 *
 * Returns a Map key → { rank, outOf }. Equal values share the lower (better)
 * rank and the next distinct value skips — standard competition ranking, so two
 * joint fastest efforts are both "1st" and the next is "3rd".
 */
function rankBy<T>(
  items: T[],
  keyOf: (t: T) => string,
  valueOf: (t: T) => number | null | undefined,
  direction: 'asc' | 'desc',
): Map<string, { rank: number; outOf: number }> {
  const scored: Array<{ key: string; value: number }> = [];
  for (const it of items) {
    const v = valueOf(it);
    if (v == null || !Number.isFinite(v)) continue;
    scored.push({ key: keyOf(it), value: v });
  }
  scored.sort((a, b) => (direction === 'asc' ? a.value - b.value : b.value - a.value));

  const out = new Map<string, { rank: number; outOf: number }>();
  const outOf = scored.length;
  let lastValue: number | null = null;
  let lastRank = 0;
  scored.forEach((s, i) => {
    const rank = lastValue !== null && s.value === lastValue ? lastRank : i + 1;
    lastValue = s.value;
    lastRank = rank;
    // A key can appear once per ranking; the first (best) placing wins.
    if (!out.has(s.key)) out.set(s.key, { rank, outOf });
  });
  return out;
}

function push(map: Map<string, Highlight[]>, id: string, h: Highlight) {
  const list = map.get(id);
  if (list) list.push(h);
  else map.set(id, [h]);
}

// ——— configuration —————————————————————————————————————————————————

/** Below this many efforts a "3rd fastest of 3" is noise rather than a fact. */
const MIN_EFFORTS_FOR_SEGMENT_RANK = 3;
/**
 * HR-derived metrics go null far more often than the effort count suggests, so
 * a segment with nine efforts can have two with an efficiency factor. "1st of 2"
 * is a coin toss, not a distinction — the RANKED set has its own floor.
 */
const MIN_RANKED_FOR_METRIC = 3;
/** Below this many outings of a type, an all-time record is just "the only one". */
const MIN_ACTIVITIES_FOR_RECORD = 4;
/** Placings worth celebrating. */
const TOP_N_SEGMENT = 5;
const TOP_N_RECORD = 3;
const TOP_N_ENVIRONMENT = 3;
/** A pair of segments must have been chained this often before its time ranks. */
const MIN_PAIR_OCCURRENCES = 2;
/** A gap this long makes the next outing of that type a story on its own. */
const RETURN_GAP_DAYS = 21;

const SEGMENT_WEIGHTS = [100, 92, 86, 81, 77];
const CHAIN_WEIGHTS = [90, 80, 72];
const RECORD_WEIGHTS = [88, 78, 70];
const HARDEST_WEIGHTS = [86, 76, 68];
const EFFICIENCY_WEIGHTS = [84, 74, 66];
const SEGMENT_EF_WEIGHTS = [82, 73, 65];
const SEGMENT_BPK_WEIGHTS = [80, 71, 63];
const ENVIRONMENT_WEIGHTS = [60, 52, 46];
const TIMING_WEIGHTS = [58, 50, 44];

function weightAt(table: number[], rank: number): number {
  return table[rank - 1] ?? table[table.length - 1];
}

// ——— the engine ————————————————————————————————————————————————————

export interface HighlightOptions {
  /** Overrides "now" for the rhythm families. Unix seconds. */
  now?: number;
}

/**
 * Compute every highlight for every activity.
 *
 * The return is keyed by activity id and each list is sorted best-first, so a
 * table shows `list[0]` and a detail page shows the lot.
 */
export function computeHighlights(
  activities: ActivityFacts[],
  efforts: EffortFacts[],
  _options: HighlightOptions = {},
): Map<string, Highlight[]> {
  const out = new Map<string, Highlight[]>();
  if (!activities.length) return out;

  const byId = new Map(activities.map((a) => [a.id, a]));
  const eligible = activities.filter((a) => !a.excludedFromSegments);

  // ——— 1. segment placings ————————————————————————————————————
  //
  // One ranking per segment, over every effort ever recorded on it. An effort
  // belonging to an excluded activity is dropped from the ranking entirely, not
  // merely hidden — otherwise a bad recording still pushes real efforts down.
  const liveEfforts = efforts.filter((e) => {
    const a = byId.get(e.activityId);
    return !!a && !a.excludedFromSegments;
  });

  const bySegment = new Map<number, EffortFacts[]>();
  for (const e of liveEfforts) {
    const list = bySegment.get(e.segmentId);
    if (list) list.push(e);
    else bySegment.set(e.segmentId, [e]);
  }

  for (const [segmentId, segEfforts] of bySegment) {
    if (segEfforts.length < MIN_EFFORTS_FOR_SEGMENT_RANK) continue;
    const name = segEfforts[0].segmentName;
    const segType = segEfforts[0].segmentActivityType;
    const effortKey = (e: EffortFacts) => `${e.activityId}#${e.lapIndex}`;

    const byTime = rankBy(segEfforts, effortKey, (e) => e.durationS, 'asc');
    // EF and beats-per-km are only meaningful where pace is the sport's currency.
    const paceSport = isPaceSport(segType);
    const byEf = paceSport
      ? rankBy(segEfforts, effortKey, (e) => e.efficiencyFactor, 'desc')
      : new Map<string, { rank: number; outOf: number }>();
    const byBpk = paceSport
      ? rankBy(segEfforts, effortKey, (e) => e.beatsPerKm, 'asc')
      : new Map<string, { rank: number; outOf: number }>();

    for (const e of segEfforts) {
      const key = effortKey(e);

      const t = byTime.get(key);
      if (t && t.rank <= TOP_N_SEGMENT) {
        push(out, e.activityId, {
          kind: 'segment_rank',
          scope: 'segment',
          rank: t.rank,
          outOf: t.outOf,
          label: t.rank === 1 ? 'Segment PB' : `${ordinal(t.rank)} fastest`,
          detail: `${name} in ${hhmm(e.durationS)} — ${t.rank === 1 ? 'best' : ordinal(t.rank)} of ${t.outOf} efforts`,
          weight: weightAt(SEGMENT_WEIGHTS, t.rank),
          segmentId,
          segmentName: name,
        });
      }

      const ef = byEf.get(key);
      if (ef && ef.rank <= TOP_N_RECORD && ef.outOf >= MIN_RANKED_FOR_METRIC && e.efficiencyFactor != null) {
        push(out, e.activityId, {
          kind: 'segment_ef',
          scope: 'segment',
          rank: ef.rank,
          outOf: ef.outOf,
          label: ef.rank === 1 ? 'Most efficient here' : `${ordinal(ef.rank)} most efficient`,
          detail: `${name} at EF ${e.efficiencyFactor.toFixed(2)} — ${ordinal(ef.rank)} of ${ef.outOf}`,
          weight: weightAt(SEGMENT_EF_WEIGHTS, ef.rank),
          segmentId,
          segmentName: name,
        });
      }

      const bpk = byBpk.get(key);
      if (bpk && bpk.rank <= TOP_N_RECORD && bpk.outOf >= MIN_RANKED_FOR_METRIC && e.beatsPerKm != null) {
        push(out, e.activityId, {
          kind: 'segment_bpk',
          scope: 'segment',
          rank: bpk.rank,
          outOf: bpk.outOf,
          label: bpk.rank === 1 ? 'Cheapest here' : `${ordinal(bpk.rank)} cheapest`,
          detail: `${name} at ${Math.round(e.beatsPerKm)} beats/km — ${ordinal(bpk.rank)} of ${bpk.outOf}`,
          weight: weightAt(SEGMENT_BPK_WEIGHTS, bpk.rank),
          segmentId,
          segmentName: name,
        });
      }
    }
  }

  // ——— 2. back-to-back pairs ————————————————————————————————————
  //
  // Two segments run one after the other are a third thing: the chain. The time
  // measured is start-of-first to end-of-second, so the transition between them
  // counts — that is the part you actually get better at.
  const chains = collectChains(liveEfforts);
  for (const [pairKey, occurrences] of chains) {
    if (occurrences.length < MIN_PAIR_OCCURRENCES) continue;
    const ranked = rankBy(
      occurrences,
      (o) => `${o.activityId}#${o.lapIndex}`,
      (o) => o.elapsedS,
      'asc',
    );
    for (const o of occurrences) {
      const r = ranked.get(`${o.activityId}#${o.lapIndex}`);
      if (!r || r.rank > TOP_N_RECORD) continue;
      push(out, o.activityId, {
        kind: 'back_to_back',
        scope: 'segment',
        rank: r.rank,
        outOf: r.outOf,
        label: r.rank === 1 ? 'Best back-to-back' : `${ordinal(r.rank)} best back-to-back`,
        detail: `${o.firstName} → ${o.secondName} in ${hhmm(o.elapsedS)} — ${ordinal(r.rank)} of ${r.outOf}`,
        weight: weightAt(CHAIN_WEIGHTS, r.rank),
        segmentId: o.firstSegmentId,
        segmentName: `${o.firstName} → ${o.secondName}`,
      });
      void pairKey;
    }
  }

  // ——— 3. activity records, per effective type ————————————————————
  const byType = new Map<string, ActivityFacts[]>();
  for (const a of eligible) {
    const list = byType.get(a.activityType);
    if (list) list.push(a);
    else byType.set(a.activityType, [a]);
  }

  for (const [type, group] of byType) {
    const noun = typeNoun(type);
    const nounPlural = typeNoun(type, true);
    const paceSport = isPaceSport(type);

    if (group.length >= MIN_ACTIVITIES_FOR_RECORD) {
      const records: Array<{
        kind: string;
        map: Map<string, { rank: number; outOf: number }>;
        weights: number[];
        label: (rank: number) => string;
        detail: (a: ActivityFacts, rank: number, outOf: number) => string;
      }> = [
        {
          kind: 'record_distance',
          map: rankBy(group, (a) => a.id, (a) => a.distanceM, 'desc'),
          weights: RECORD_WEIGHTS,
          label: (rank) => (rank === 1 ? `Longest ${noun}` : `${ordinal(rank)} longest`),
          detail: (a, rank, outOf) =>
            `${km(a.distanceM)} — ${ordinal(rank)} longest of ${outOf} ${nounPlural}`,
        },
        {
          kind: 'record_duration',
          map: rankBy(group, (a) => a.id, (a) => a.durationS, 'desc'),
          weights: RECORD_WEIGHTS,
          label: (rank) => (rank === 1 ? `Longest time out` : `${ordinal(rank)} longest time`),
          detail: (a, rank, outOf) =>
            `${hhmm(a.durationS)} — ${ordinal(rank)} of ${outOf} ${nounPlural}`,
        },
        {
          kind: 'record_climb',
          map: rankBy(group, (a) => a.id, (a) => a.elevationGainM, 'desc'),
          weights: RECORD_WEIGHTS,
          label: (rank) => (rank === 1 ? 'Most climbing' : `${ordinal(rank)} most climbing`),
          detail: (a, rank, outOf) =>
            `${Math.round(a.elevationGainM ?? 0)} m of climb — ${ordinal(rank)} of ${outOf} ${nounPlural}`,
        },
        {
          kind: 'record_pace',
          // Pace is seconds per km: lower is faster.
          map: rankBy(group, (a) => a.id, (a) => a.avgPaceSPerKm, 'asc'),
          weights: RECORD_WEIGHTS,
          label: (rank) =>
            rank === 1
              ? paceSport
                ? `Fastest ${noun}`
                : `Quickest ${noun}`
              : `${ordinal(rank)} fastest`,
          detail: (a, rank, outOf) =>
            paceSport
              ? `${paceLabel(a.avgPaceSPerKm)} — ${ordinal(rank)} of ${outOf} ${nounPlural}`
              : `${speedLabel(a.avgPaceSPerKm)} — ${ordinal(rank)} of ${outOf} ${nounPlural}`,
        },
        {
          kind: 'record_energy',
          map: rankBy(group, (a) => a.id, (a) => a.activeEnergyKj, 'desc'),
          weights: RECORD_WEIGHTS,
          label: (rank) => (rank === 1 ? 'Biggest burn' : `${ordinal(rank)} biggest burn`),
          detail: (a, rank, outOf) =>
            `${Math.round((a.activeEnergyKj ?? 0) / 4.184)} kcal — ${ordinal(rank)} of ${outOf} ${nounPlural}`,
        },
      ];

      for (const rec of records) {
        for (const a of group) {
          const r = rec.map.get(a.id);
          if (!r || r.rank > TOP_N_RECORD) continue;
          push(out, a.id, {
            kind: rec.kind,
            scope: 'activity',
            rank: r.rank,
            outOf: r.outOf,
            label: rec.label(r.rank),
            detail: rec.detail(a, r.rank, r.outOf),
            weight: weightAt(rec.weights, r.rank),
          });
        }
      }

      // Hardest — distance and climb combined the way the planner grades routes,
      // so "hard" means the same thing on a finished outing as on a proposed one.
      const hardest = rankBy(
        group,
        (a) => a.id,
        (a) =>
          a.distanceM == null
            ? null
            : gradeDifficulty({
                distanceM: a.distanceM,
                ascentM: a.elevationGainM ?? null,
                sport: type,
              }).equivalentKm,
        'desc',
      );
      for (const a of group) {
        const r = hardest.get(a.id);
        if (!r || r.rank > TOP_N_RECORD || a.distanceM == null) continue;
        const grade = gradeDifficulty({
          distanceM: a.distanceM,
          ascentM: a.elevationGainM ?? null,
          sport: type,
        });
        push(out, a.id, {
          kind: 'hardest',
          scope: 'activity',
          rank: r.rank,
          outOf: r.outOf,
          label: r.rank === 1 ? `Hardest ${noun}` : `${ordinal(r.rank)} hardest`,
          // The difficulty BAND is deliberately not printed here: a ride can be
          // the hardest of 294 and still sit in the 'easy' band, and "2nd hardest
          // (easy)" reads as a contradiction. The equivalent-km is the fact.
          detail: `${grade.equivalentKm} equivalent-km — ${ordinal(r.rank)} hardest of ${r.outOf} ${nounPlural}`,
          weight: weightAt(HARDEST_WEIGHTS, r.rank),
        });
      }

      // Whole-workout efficiency factor. Pace sports only — see rule 1.
      if (paceSport) {
        const efRank = rankBy(
          group,
          (a) => a.id,
          (a) => wholeEf(a),
          'desc',
        );
        for (const a of group) {
          const r = efRank.get(a.id);
          const ef = wholeEf(a);
          if (!r || r.rank > TOP_N_RECORD || ef == null) continue;
          push(out, a.id, {
            kind: 'most_efficient',
            scope: 'activity',
            rank: r.rank,
            outOf: r.outOf,
            label: r.rank === 1 ? 'Most efficient' : `${ordinal(r.rank)} most efficient`,
            detail: `EF ${ef.toFixed(2)} — ${ordinal(r.rank)} of ${r.outOf} ${nounPlural}`,
            weight: weightAt(EFFICIENCY_WEIGHTS, r.rank),
          });
        }
      }
    }

    // ——— 4. conditions and clock ————————————————————————————————
    //
    // Only outdoor outings compete on temperature — a turbo session in a warm
    // garage is not the hottest ride of the year. `indoor === null` (no
    // metadata) is treated as unknown and excluded, deliberately.
    const outdoor = group.filter((a) => a.indoor === false && a.tempC != null);
    if (outdoor.length >= MIN_ACTIVITIES_FOR_RECORD) {
      const hottest = rankBy(outdoor, (a) => a.id, (a) => a.tempC, 'desc');
      const coldest = rankBy(outdoor, (a) => a.id, (a) => a.tempC, 'asc');
      for (const a of outdoor) {
        const h = hottest.get(a.id);
        if (h && h.rank <= TOP_N_ENVIRONMENT) {
          push(out, a.id, {
            kind: 'hottest',
            scope: 'environment',
            rank: h.rank,
            outOf: h.outOf,
            label: h.rank === 1 ? `Hottest ${noun}` : `${ordinal(h.rank)} hottest`,
            detail: `${a.tempC!.toFixed(1)}°C — ${ordinal(h.rank)} warmest of ${h.outOf} outdoor ${nounPlural}`,
            weight: weightAt(ENVIRONMENT_WEIGHTS, h.rank),
          });
        }
        const c = coldest.get(a.id);
        if (c && c.rank <= TOP_N_ENVIRONMENT) {
          push(out, a.id, {
            kind: 'coldest',
            scope: 'environment',
            rank: c.rank,
            outOf: c.outOf,
            label: c.rank === 1 ? `Coldest ${noun}` : `${ordinal(c.rank)} coldest`,
            detail: `${a.tempC!.toFixed(1)}°C — ${ordinal(c.rank)} coldest of ${c.outOf} outdoor ${nounPlural}`,
            weight: weightAt(ENVIRONMENT_WEIGHTS, c.rank),
          });
        }
      }
    }

    const timed = group.filter((a) => a.minutesOfDay != null);
    if (timed.length >= MIN_ACTIVITIES_FOR_RECORD) {
      const earliest = rankBy(timed, (a) => a.id, (a) => a.minutesOfDay, 'asc');
      const latest = rankBy(timed, (a) => a.id, (a) => a.minutesOfDay, 'desc');
      for (const a of timed) {
        const e = earliest.get(a.id);
        if (e && e.rank <= TOP_N_ENVIRONMENT) {
          push(out, a.id, {
            kind: 'earliest',
            scope: 'environment',
            rank: e.rank,
            outOf: e.outOf,
            label: e.rank === 1 ? 'Earliest start' : `${ordinal(e.rank)} earliest`,
            detail: `Away at ${clock(a.minutesOfDay!)} — ${ordinal(e.rank)} earliest of ${e.outOf} ${nounPlural}`,
            weight: weightAt(TIMING_WEIGHTS, e.rank),
          });
        }
        const l = latest.get(a.id);
        if (l && l.rank <= TOP_N_ENVIRONMENT) {
          push(out, a.id, {
            kind: 'latest',
            scope: 'environment',
            rank: l.rank,
            outOf: l.outOf,
            label: l.rank === 1 ? 'Latest start' : `${ordinal(l.rank)} latest`,
            detail: `Out at ${clock(a.minutesOfDay!)} — ${ordinal(l.rank)} latest of ${l.outOf} ${nounPlural}`,
            weight: weightAt(TIMING_WEIGHTS, l.rank),
          });
        }
      }
    }

    // ——— 5. the floors, so no row is ever blank ————————————————————
    const chronological = [...group].sort((a, b) => a.startDate - b.startDate);
    chronological.forEach((a, i) => {
      if (group.length === 1) {
        push(out, a.id, {
          kind: 'only_one',
          scope: 'rhythm',
          rank: null,
          outOf: 1,
          label: `Your only ${noun}`,
          detail: `The one and only ${noun} on record`,
          weight: 30,
        });
        return;
      }
      if (i === 0) {
        push(out, a.id, {
          kind: 'first_of_type',
          scope: 'rhythm',
          rank: null,
          outOf: group.length,
          label: `First ${noun}`,
          detail: `Where the ${nounPlural} started — ${group.length} since`,
          weight: 35,
        });
        return;
      }
      const gapDays = Math.round((a.startDate - chronological[i - 1].startDate) / 86_400);
      if (gapDays >= RETURN_GAP_DAYS) {
        push(out, a.id, {
          kind: 'first_since',
          scope: 'rhythm',
          rank: null,
          outOf: group.length,
          label: 'Back to it',
          detail: `First ${noun} in ${gapDays} days`,
          weight: 42,
        });
      }
    });

    // ——— recent form ————————————————————————————————————————
    //
    // Most outings are not an all-time anything, and "On the board" is not a
    // reason to have gone. A trailing window is: being the fastest of your last
    // ten walks is a real distinction that a short Tuesday loop can actually
    // win, and it is the honest way to say something excellent about the middle
    // of the distribution.
    addWindowBests(chronological, type, out);
    addMonthBests(chronological, type, out);
    addVersusTypical(chronological, type, out);

    // Percentile on distance (or duration where there is no distance) is the
    // universal floor: it needs nothing but the group and it always has an
    // answer.
    if (group.length >= 8) {
      const metric = (a: ActivityFacts) => a.distanceM ?? a.durationS;
      const sorted = [...group].sort((x, y) => metric(x) - metric(y));
      sorted.forEach((a, i) => {
        const beaten = i; // strictly-below count in this ordering
        const pct = Math.round((beaten / (group.length - 1)) * 100);
        if (pct < 50) return; // "shorter than most" is not a highlight
        push(out, a.id, {
          kind: 'percentile',
          scope: 'activity',
          rank: null,
          outOf: group.length,
          label: pct >= 90 ? 'Big one' : 'Above your average',
          detail:
            a.distanceM != null
              ? `Longer than ${pct}% of your ${nounPlural}`
              : `Longer out than ${pct}% of your ${nounPlural}`,
          weight: 24 + pct / 5,
        });
      });
    }
  }

  // ——— 6. rhythm across every type ————————————————————————————————
  addStreaks(eligible, out);
  addDayBests(eligible, out);
  addWeekCadence(eligible, out);

  // ——— 7. the invariant ————————————————————————————————————————
  //
  // Nothing above is guaranteed to fire for a lone short outing in a small
  // group, so anything still empty gets the plainest true fact there is.
  for (const a of activities) {
    if (out.has(a.id)) continue;
    push(out, a.id, {
      kind: 'logged',
      scope: 'rhythm',
      rank: null,
      outOf: null,
      label: a.excludedFromSegments ? 'Excluded' : 'On the board',
      detail: a.excludedFromSegments
        ? 'Left out of segment analysis'
        : `${km(a.distanceM)} of ${typeNoun(a.activityType)} in ${hhmm(a.durationS)}`,
      weight: 5,
    });
  }

  for (const list of out.values()) {
    list.sort((x, y) => y.weight - x.weight || x.kind.localeCompare(y.kind));
  }
  return out;
}

// ——— recent form ————————————————————————————————————————————————

/** How many outings back a "of your last N" claim looks. */
const WINDOW_N = 10;
/** Below this the window is too short for "of your last N" to mean anything. */
const MIN_WINDOW = 5;
/** A calendar month needs this many outings before a monthly best is a fact. */
const MIN_MONTH = 3;

const WINDOW_WEIGHT = 62;
const MONTH_WEIGHT = 66;
const DAY_WEIGHT = 48;

interface Measure {
  key: string;
  read: (a: ActivityFacts) => number | null;
  direction: 'asc' | 'desc';
  best: (noun: string, n: number) => string;
  monthBest: (noun: string) => string;
  say: (a: ActivityFacts) => string;
}

function measures(type: string): Measure[] {
  const paceSport = isPaceSport(type);
  const list: Measure[] = [
    {
      key: 'distance',
      read: (a) => a.distanceM,
      direction: 'desc',
      best: (noun, n) => `Longest of your last ${n}`,
      monthBest: () => 'Longest this month',
      say: (a) => km(a.distanceM),
    },
    {
      key: 'pace',
      read: (a) => a.avgPaceSPerKm,
      direction: 'asc',
      best: (noun, n) => (paceSport ? `Fastest of your last ${n}` : `Quickest of your last ${n}`),
      monthBest: () => (paceSport ? 'Fastest this month' : 'Quickest this month'),
      say: (a) => (paceSport ? paceLabel(a.avgPaceSPerKm) : speedLabel(a.avgPaceSPerKm)),
    },
    {
      key: 'climb',
      read: (a) => a.elevationGainM,
      direction: 'desc',
      best: (noun, n) => `Most climb of your last ${n}`,
      monthBest: () => 'Most climb this month',
      say: (a) => `${Math.round(a.elevationGainM ?? 0)} m of climb`,
    },
  ];
  if (paceSport) {
    list.push({
      key: 'ef',
      read: (a) => wholeEf(a),
      direction: 'desc',
      best: (noun, n) => `Most efficient of your last ${n}`,
      monthBest: () => 'Most efficient this month',
      say: (a) => `EF ${(wholeEf(a) ?? 0).toFixed(2)}`,
    });
  }
  return list;
}

function better(a: number, b: number, direction: 'asc' | 'desc'): boolean {
  return direction === 'asc' ? a < b : a > b;
}

/**
 * Best of the trailing window, per measure.
 *
 * The window is the WINDOW_N most recent outings of this type up to and
 * including this one — never a look-ahead, so a claim made about a 2024 walk
 * still reads true against the 2024 record and does not silently change when a
 * faster walk happens next week.
 */
function addWindowBests(chronological: ActivityFacts[], type: string, out: Map<string, Highlight[]>) {
  if (chronological.length < MIN_WINDOW) return;
  const noun = typeNoun(type);
  const nounPlural = typeNoun(type, true);
  for (const m of measures(type)) {
    for (let i = MIN_WINDOW - 1; i < chronological.length; i++) {
      const a = chronological[i];
      const mine = m.read(a);
      if (mine == null || !Number.isFinite(mine)) continue;
      const from = Math.max(0, i - (WINDOW_N - 1));
      const window = chronological.slice(from, i + 1);
      const others = window.filter((w) => w.id !== a.id).map(m.read).filter((v): v is number => v != null && Number.isFinite(v));
      if (others.length < MIN_WINDOW - 1) continue;
      if (!others.every((v) => better(mine, v, m.direction))) continue;
      push(out, a.id, {
        kind: `window_${m.key}`,
        scope: 'activity',
        rank: 1,
        outOf: others.length + 1,
        label: m.best(noun, others.length + 1),
        detail: `${m.say(a)} — best of your last ${others.length + 1} ${nounPlural}`,
        weight: WINDOW_WEIGHT,
      });
    }
  }
}

/** Best of the calendar month it happened in, per measure. */
function addMonthBests(chronological: ActivityFacts[], type: string, out: Map<string, Highlight[]>) {
  const months = new Map<string, ActivityFacts[]>();
  for (const a of chronological) {
    if (!a.day) continue;
    const key = a.day.slice(0, 7);
    const list = months.get(key);
    if (list) list.push(a);
    else months.set(key, [a]);
  }
  const nounPlural = typeNoun(type, true);
  for (const [key, group] of months) {
    if (group.length < MIN_MONTH) continue;
    for (const m of measures(type)) {
      const ranked = rankBy(group, (a) => a.id, m.read, m.direction);
      for (const a of group) {
        const r = ranked.get(a.id);
        if (!r || r.rank !== 1 || r.outOf < MIN_MONTH) continue;
        push(out, a.id, {
          kind: `month_${m.key}`,
          scope: 'activity',
          rank: 1,
          outOf: r.outOf,
          label: m.monthBest(nounPlural),
          detail: `${m.say(a)} — best of ${r.outOf} ${nounPlural} in ${monthName(key)}`,
          weight: MONTH_WEIGHT,
        });
      }
    }
  }
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthName(yyyymm: string): string {
  const m = Number(yyyymm.slice(5, 7));
  return `${MONTHS[m - 1] ?? yyyymm} ${yyyymm.slice(0, 4)}`;
}

/** When a day held more than one outing, the biggest of them is worth saying. */
function addDayBests(activities: ActivityFacts[], out: Map<string, Highlight[]>) {
  const days = new Map<string, ActivityFacts[]>();
  for (const a of activities) {
    if (!a.day) continue;
    const list = days.get(a.day);
    if (list) list.push(a);
    else days.set(a.day, [a]);
  }
  for (const [, group] of days) {
    if (group.length < 2) continue;
    const ranked = rankBy(group, (a) => a.id, (a) => a.distanceM ?? a.durationS, 'desc');
    for (const a of group) {
      const r = ranked.get(a.id);
      const top = r?.rank === 1;
      push(out, a.id, {
        kind: top ? 'day_best' : 'day_part',
        scope: 'rhythm',
        rank: r?.rank ?? null,
        outOf: group.length,
        label: top ? `Biggest of ${group.length} that day` : `${group.length} outings that day`,
        detail: top
          ? `${group.length} outings that day; this was the longest`
          : `One of ${group.length} times out that day`,
        weight: top ? DAY_WEIGHT : DAY_WEIGHT - 18,
      });
    }
  }
}

// ——— relative to your usual ————————————————————————————————————

/** The trailing window a "your usual" claim is measured against. */
const TYPICAL_WINDOW_DAYS = 90;
/** A median of two is whichever one happened. */
const MIN_TYPICAL_SAMPLE = 5;
/** Below this the difference is noise, not a performance. */
const MIN_TYPICAL_DELTA = 0.03;

const TYPICAL_WEIGHT = 52;
/**
 * Turning up is the weakest true thing that can be said, so it sits just above
 * the bare "logged" floor: it should never lead a row that has a placing, a
 * record, or even a percentile to show. Getting this wrong made 40% of the list
 * read "3rd outing that week".
 */
const WEEK_WEIGHT = 28;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * How this one compares with your usual.
 *
 * The comparison set is the same sport over the preceding 90 days and NOTHING
 * after it — an outing is measured against what had happened by then, so a claim
 * made about a walk in March does not quietly change when April is faster.
 */
function addVersusTypical(chronological: ActivityFacts[], type: string, out: Map<string, Highlight[]>) {
  const noun = typeNoun(type);
  const paceSport = isPaceSport(type);
  const windowS = TYPICAL_WINDOW_DAYS * 86_400;

  for (let i = 0; i < chronological.length; i++) {
    const a = chronological[i];
    const since = a.startDate - windowS;
    const prior = chronological.slice(0, i).filter((p) => p.startDate >= since);
    if (prior.length < MIN_TYPICAL_SAMPLE) continue;

    const mine = a.avgPaceSPerKm;
    const usual = median(prior.map((p) => p.avgPaceSPerKm).filter((v): v is number => v != null && v > 0));
    if (mine != null && mine > 0 && usual) {
      // Pace is seconds per km, so quicker is a SMALLER number.
      const delta = (usual - mine) / usual;
      if (delta >= MIN_TYPICAL_DELTA) {
        push(out, a.id, {
          kind: 'vs_typical_pace',
          scope: 'activity',
          rank: null,
          outOf: prior.length,
          label: paceSport ? 'Quicker than usual' : 'Faster than usual',
          detail: `${Math.round(delta * 100)}% ${paceSport ? 'quicker' : 'faster'} than your typical ${noun} (${prior.length} in 90 days)`,
          weight: TYPICAL_WEIGHT + Math.min(8, Math.round(delta * 40)),
        });
      }
    }

    if (paceSport) {
      const ef = wholeEf(a);
      const usualEf = median(prior.map(wholeEf).filter((v): v is number => v != null && v > 0));
      if (ef != null && usualEf) {
        const delta = (ef - usualEf) / usualEf;
        if (delta >= MIN_TYPICAL_DELTA) {
          push(out, a.id, {
            kind: 'vs_typical_ef',
            scope: 'activity',
            rank: null,
            outOf: prior.length,
            label: 'Cheaper than usual',
            detail: `${Math.round(delta * 100)}% more distance per beat than your typical ${noun}`,
            weight: TYPICAL_WEIGHT + Math.min(8, Math.round(delta * 40)),
          });
        }
      }
    }
  }
}

/** Turning up counts: how many times out that ISO week, this one included. */
function addWeekCadence(activities: ActivityFacts[], out: Map<string, Highlight[]>) {
  const weeks = new Map<string, ActivityFacts[]>();
  for (const a of activities) {
    if (!a.day) continue;
    const key = isoWeekKey(a.day);
    const list = weeks.get(key);
    if (list) list.push(a);
    else weeks.set(key, [a]);
  }
  for (const [, group] of weeks) {
    if (group.length < 3) continue;
    const ordered = [...group].sort((x, y) => x.startDate - y.startDate);
    ordered.forEach((a, i) => {
      push(out, a.id, {
        kind: 'week_cadence',
        scope: 'rhythm',
        rank: i + 1,
        outOf: group.length,
        label: `${ordinal(i + 1)} outing that week`,
        detail: `${group.length} times out in that week`,
        weight: WEEK_WEIGHT + Math.min(6, group.length),
      });
    });
  }
}

/** ISO-week key from a local `YYYY-MM-DD`, so a Sunday belongs to the week it ends. */
function isoWeekKey(day: string): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ——— chains ————————————————————————————————————————————————————————

interface ChainOccurrence {
  activityId: string;
  lapIndex: number;
  firstSegmentId: number;
  firstName: string;
  secondName: string;
  elapsedS: number;
}

/**
 * Ordered pairs of segments taken one straight after the other.
 *
 * "Straight after" is generous on purpose — up to two minutes between the end
 * of one and the start of the next, which covers a gate, a road crossing or a
 * dropped GPS sample without letting a coffee stop count as a chain.
 */
const MAX_CHAIN_GAP_S = 120;

export function collectChains(efforts: EffortFacts[]): Map<string, ChainOccurrence[]> {
  const byActivity = new Map<string, EffortFacts[]>();
  for (const e of efforts) {
    const list = byActivity.get(e.activityId);
    if (list) list.push(e);
    else byActivity.set(e.activityId, [e]);
  }

  const chains = new Map<string, ChainOccurrence[]>();
  for (const [activityId, list] of byActivity) {
    const ordered = [...list].sort((a, b) => a.startS - b.startS);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const next = ordered[i];
      if (prev.segmentId === next.segmentId) continue;
      const gap = next.startS - prev.endS;
      if (gap < 0 || gap > MAX_CHAIN_GAP_S) continue;
      const key = `${prev.segmentId}>${next.segmentId}`;
      const occ: ChainOccurrence = {
        activityId,
        lapIndex: prev.lapIndex,
        firstSegmentId: prev.segmentId,
        firstName: prev.segmentName,
        secondName: next.segmentName,
        elapsedS: next.endS - prev.startS,
      };
      const bucket = chains.get(key);
      if (bucket) bucket.push(occ);
      else chains.set(key, [occ]);
    }
  }
  return chains;
}

// ——— streaks ————————————————————————————————————————————————————

function addStreaks(activities: ActivityFacts[], out: Map<string, Highlight[]>) {
  const days = new Map<string, ActivityFacts[]>();
  for (const a of activities) {
    if (!a.day) continue;
    const list = days.get(a.day);
    if (list) list.push(a);
    else days.set(a.day, [a]);
  }
  const ordered = [...days.keys()].sort();
  let runLength = 0;
  let previous: string | null = null;
  for (const day of ordered) {
    runLength = previous && dayDiff(previous, day) === 1 ? runLength + 1 : 1;
    previous = day;
    if (runLength < 3) continue;
    // The streak belongs to the day's longest outing, so one day does not
    // collect the same badge three times.
    const best = days
      .get(day)!
      .slice()
      .sort((a, b) => (b.distanceM ?? b.durationS) - (a.distanceM ?? a.durationS))[0];
    push(out, best.id, {
      kind: 'streak',
      scope: 'rhythm',
      rank: null,
      outOf: null,
      label: `${runLength}-day streak`,
      detail: `Day ${runLength} of moving every day`,
      weight: Math.min(70, 40 + runLength * 2),
    });
  }
}

/** Whole days between two `YYYY-MM-DD` strings, read as dates and nothing else. */
function dayDiff(a: string, b: string): number {
  const ms = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const ns = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((ns - ms) / 86_400_000);
}

// ——— derived numbers ————————————————————————————————————————————

/**
 * Whole-workout efficiency factor, reusing the same maths the physio suite uses
 * so a segment number and an activity number stay comparable.
 */
function wholeEf(a: ActivityFacts): number | null {
  const moving = a.movingS ?? a.durationS;
  if (!a.distanceM || !moving || !a.avgHeartrate) return null;
  if (moving <= 0 || a.avgHeartrate <= 0) return null;
  return Math.round((a.distanceM / (moving / 60) / a.avgHeartrate) * 1000) / 1000;
}

function paceLabel(secondsPerKm: number | null): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  const [mm, ss] = s === 60 ? [m + 1, 0] : [m, s];
  return `${mm}:${String(ss).padStart(2, '0')} /km`;
}

function speedLabel(secondsPerKm: number | null): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  return `${(3600 / secondsPerKm).toFixed(1)} km/h`;
}
