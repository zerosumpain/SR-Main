// tracking/assemble.ts — turn one observed value into a snapshot record: attach both
// scenario projections for the reference year and classify reality against each. Pure
// (no DB / no fetch) so the observed-vs-projected logic is fully unit-tested.

import type { IndicatorSpec, TrackStatus } from './types';
import { dualProjections, type ProjectionSims } from './projection';
import { classifyStatus } from './status';

/** The domain shape persisted as one policy_indicator_snapshots row (numbers, not drizzle types). */
export interface SnapshotData {
  indicatorKey: string;
  unit: string;
  observedValue: number | null;
  refYear: number;
  refPeriodLabel: string;
  source: string;
  sourceUrl: string | null;
  releaseDate: string | null;
  releaseHash: string | null;
  projectedBaseline: number | null;
  projectedPolicy: number | null;
  statusVsBaseline: TrackStatus;
  statusVsPolicy: TrackStatus;
  live: boolean;
  raw: unknown;
}

export interface AssembleArgs {
  spec: IndicatorSpec;
  observedValue: number | null;
  refYear: number;
  refPeriodLabel: string;
  releaseDate: string | null;
  releaseHash: string | null;
  live: boolean;
  sims: ProjectionSims;
  /** Optional explicit uncertainty band (e.g. Monte-Carlo P10–P90) for the status call. */
  mcBand?: { lo: number; hi: number };
  raw?: unknown;
}

export function assembleSnapshot(args: AssembleArgs): SnapshotData {
  const { spec, observedValue, refYear } = args;
  const { baseline, policy } = dualProjections(spec, refYear, args.sims);
  const opts = { goodIfUp: spec.goodIfUp, band: args.mcBand };
  return {
    indicatorKey: spec.key,
    unit: spec.unit,
    observedValue: observedValue != null && Number.isFinite(observedValue) ? observedValue : null,
    refYear,
    refPeriodLabel: args.refPeriodLabel,
    source: `${spec.source.publisher} — ${spec.source.name}`,
    sourceUrl: spec.source.url ?? null,
    releaseDate: args.releaseDate,
    releaseHash: args.releaseHash,
    projectedBaseline: baseline,
    projectedPolicy: policy,
    statusVsBaseline: classifyStatus(observedValue, baseline, opts),
    statusVsPolicy: classifyStatus(observedValue, policy, opts),
    live: args.live,
    raw: args.raw ?? null,
  };
}
