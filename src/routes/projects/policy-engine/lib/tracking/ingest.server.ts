// tracking/ingest.server.ts — the orchestrator. For a cadence group: fetch the live
// observed values (release-gated so we only rewrite when a publication actually moved),
// attach both scenario projections + statuses, and upsert one snapshot per indicator/year.
// Driven by the jkai cron workflows via /api/policy-engine/ingest; read by /monitor.

import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { policyIndicatorSnapshots, type PolicyIndicatorSnapshot } from '$lib/db/schema';
import { INDICATORS, INDICATORS_BY_KEY } from './registry';
import { buildProjectionSims, type ProjectionSims } from './projection';
import { assembleSnapshot, type SnapshotData } from './assemble';
import { fetchEesValue, fetchEesPublications, refYearFromTimePeriod, refPeriodLabel } from './ees.server';
import { fetchOnsNeet, fetchWorldBank } from './sources.server';
import { freshnessState } from './freshness';
import { BASE_YEAR } from '../params';
import type { IndicatorSpec, TrackGroup, TrackedIndicator } from './types';

const num = (v: number | null) => (v == null ? null : String(v));
const hashOf = (parts: Array<string | number | null>) =>
  createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 16);

export interface IngestSummary {
  group: string;
  fetchedAt: string;
  updated: Array<{ key: string; observed: number | null; refPeriodLabel: string; statusVsPolicy: string }>;
  unchanged: string[];
  failed: Array<{ key: string; reason: string }>;
}

interface Resolved {
  observed: number | null;
  refYear: number;
  refPeriodLabel: string;
  releaseDate: string | null;
  live: boolean;
  raw: unknown;
}

/** Fetch the observed value for one (non-derived) indicator. */
async function resolveObserved(spec: IndicatorSpec, fetchImpl: typeof fetch, pubDates: Map<string, string | null>): Promise<Resolved | null> {
  const f = spec.fetch;
  if (f.kind === 'ees') {
    const value = await fetchEesValue(f, fetchImpl);
    return {
      observed: value,
      refYear: refYearFromTimePeriod(f.timePeriod),
      refPeriodLabel: refPeriodLabel(f.timePeriod),
      releaseDate: pubDates.get(f.publicationSlug) ?? null,
      live: value != null,
      raw: { value },
    };
  }
  if (f.kind === 'ons-neet-xlsx') {
    const pt = await fetchOnsNeet(f.field, fetchImpl);
    if (!pt) return { observed: null, refYear: BASE_YEAR, refPeriodLabel: String(BASE_YEAR), releaseDate: null, live: false, raw: null };
    return { observed: pt.value, refYear: pt.refYear, refPeriodLabel: pt.refPeriodLabel, releaseDate: pt.releaseDate, live: true, raw: pt };
  }
  if (f.kind === 'worldbank') {
    const pt = await fetchWorldBank(f.indicator, f.country, fetchImpl);
    if (!pt) return { observed: null, refYear: BASE_YEAR, refPeriodLabel: String(BASE_YEAR), releaseDate: null, live: false, raw: null };
    return { observed: pt.value, refYear: pt.refYear, refPeriodLabel: pt.refPeriodLabel, releaseDate: pt.releaseDate, live: true, raw: pt };
  }
  return null; // derived + manual handled separately
}

async function upsert(snap: SnapshotData, fetchedAt: Date) {
  await db
    .insert(policyIndicatorSnapshots)
    .values({
      indicatorKey: snap.indicatorKey,
      observedValue: num(snap.observedValue),
      unit: snap.unit,
      refYear: snap.refYear,
      refPeriodLabel: snap.refPeriodLabel,
      source: snap.source,
      sourceUrl: snap.sourceUrl,
      releaseDate: snap.releaseDate ? new Date(snap.releaseDate) : null,
      releaseHash: snap.releaseHash,
      projectedBaseline: num(snap.projectedBaseline),
      projectedPolicy: num(snap.projectedPolicy),
      statusVsBaseline: snap.statusVsBaseline,
      statusVsPolicy: snap.statusVsPolicy,
      raw: snap.raw as object,
      live: snap.live,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: [policyIndicatorSnapshots.indicatorKey, policyIndicatorSnapshots.refYear],
      set: {
        observedValue: num(snap.observedValue), unit: snap.unit, refPeriodLabel: snap.refPeriodLabel,
        source: snap.source, sourceUrl: snap.sourceUrl,
        releaseDate: snap.releaseDate ? new Date(snap.releaseDate) : null, releaseHash: snap.releaseHash,
        projectedBaseline: num(snap.projectedBaseline), projectedPolicy: num(snap.projectedPolicy),
        statusVsBaseline: snap.statusVsBaseline, statusVsPolicy: snap.statusVsPolicy,
        raw: snap.raw as object, live: snap.live, fetchedAt,
      },
    });
}

export interface IngestOpts {
  group?: TrackGroup;
  force?: boolean;          // bypass the release-gate
  includeManual?: boolean;  // also (re)create projection-only rows for manual indicators
  fetchImpl?: typeof fetch;
}

export async function runIngest(opts: IngestOpts = {}): Promise<IngestSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fetchedAt = new Date();
  const sims = buildProjectionSims();
  const summary: IngestSummary = { group: opts.group ?? 'all', fetchedAt: fetchedAt.toISOString(), updated: [], unchanged: [], failed: [] };

  const scope = INDICATORS.filter((i) => (opts.group ? i.group === opts.group : true));
  if (!scope.length) return summary;

  // release dates + existing rows for gating / fallback
  const pubs = await fetchEesPublications(fetchImpl);
  const pubDates = new Map(pubs.map((p) => [p.slug, p.lastPublished] as const));
  const existing = await db.select().from(policyIndicatorSnapshots);
  const prevByKey = new Map<string, PolicyIndicatorSnapshot>();
  for (const r of existing) {
    const cur = prevByKey.get(r.indicatorKey);
    if (!cur || r.refYear > cur.refYear) prevByKey.set(r.indicatorKey, r);
  }

  // freshly observed values, for derived indicators
  const observedNow = new Map<string, number>();

  // pass 1 — directly fetched indicators
  for (const spec of scope) {
    if (spec.fetch.kind === 'derived') continue;
    try {
      if (spec.fetch.kind === 'manual') {
        if (!opts.includeManual) { summary.unchanged.push(spec.key); continue; }
        const prev = prevByKey.get(spec.key);
        if (prev && prev.observedValue != null) { summary.unchanged.push(spec.key); continue; } // keep human-entered value
        const snap = assembleSnapshot({ spec, observedValue: null, refYear: BASE_YEAR, refPeriodLabel: String(BASE_YEAR), releaseDate: null, releaseHash: null, live: false, sims });
        await upsert({ ...snap, raw: { manual: true } }, fetchedAt);
        summary.updated.push({ key: spec.key, observed: null, refPeriodLabel: String(BASE_YEAR), statusVsPolicy: snap.statusVsPolicy });
        continue;
      }

      const r = await resolveObserved(spec, fetchImpl, pubDates);
      if (!r) { summary.failed.push({ key: spec.key, reason: 'unhandled fetch kind' }); continue; }

      const prev = prevByKey.get(spec.key);
      const hash = hashOf([r.observed, r.refPeriodLabel, r.releaseDate]);

      // snapshot fallback: a failed live fetch never overwrites a good stored value
      if (r.observed == null) {
        if (prev) { summary.unchanged.push(spec.key); continue; }
      } else {
        observedNow.set(spec.key, r.observed);
      }

      // release-gate: nothing changed since last time → skip the write
      if (!opts.force && prev && prev.releaseHash === hash && prev.observedValue != null) {
        summary.unchanged.push(spec.key);
        continue;
      }

      const snap = assembleSnapshot({ spec, observedValue: r.observed, refYear: r.refYear, refPeriodLabel: r.refPeriodLabel, releaseDate: r.releaseDate, releaseHash: hash, live: r.live, sims, raw: r.raw });
      await upsert(snap, fetchedAt);
      summary.updated.push({ key: spec.key, observed: r.observed, refPeriodLabel: r.refPeriodLabel, statusVsPolicy: snap.statusVsPolicy });
    } catch (e) {
      summary.failed.push({ key: spec.key, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // pass 2 — derived indicators (computed from freshly observed deps)
  for (const spec of scope) {
    if (spec.fetch.kind !== 'derived') continue;
    try {
      const f = spec.fetch;
      const haveAll = f.from.every((k) => observedNow.has(k));
      if (!haveAll) { summary.unchanged.push(spec.key); continue; }
      const vals = Object.fromEntries(f.from.map((k) => [k, observedNow.get(k)!]));
      const observed = f.combine(vals);
      // borrow refYear/label/releaseDate from the first dependency's spec
      const dep = INDICATORS_BY_KEY[f.from[0]];
      const depFetch = dep.fetch;
      const refYear = depFetch.kind === 'ees' ? refYearFromTimePeriod(depFetch.timePeriod) : BASE_YEAR;
      const label = depFetch.kind === 'ees' ? refPeriodLabel(depFetch.timePeriod) : String(BASE_YEAR);
      const releaseDate = depFetch.kind === 'ees' ? (pubDates.get(depFetch.publicationSlug) ?? null) : null;
      const hash = hashOf([observed, label, releaseDate]);
      const prev = prevByKey.get(spec.key);
      if (!opts.force && prev && prev.releaseHash === hash && prev.observedValue != null) { summary.unchanged.push(spec.key); continue; }
      const snap = assembleSnapshot({ spec, observedValue: observed, refYear, refPeriodLabel: label, releaseDate, releaseHash: hash, live: true, sims, raw: { vals } });
      await upsert(snap, fetchedAt);
      summary.updated.push({ key: spec.key, observed, refPeriodLabel: label, statusVsPolicy: snap.statusVsPolicy });
    } catch (e) {
      summary.failed.push({ key: spec.key, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return summary;
}

/** Read path for /monitor: join stored snapshots with the registry + freshness. */
export async function loadTrackedIndicators(now = new Date()): Promise<TrackedIndicator[]> {
  const rows = await db.select().from(policyIndicatorSnapshots);
  const byKey = new Map<string, PolicyIndicatorSnapshot>();
  for (const r of rows) {
    const cur = byKey.get(r.indicatorKey);
    if (!cur || r.refYear > cur.refYear) byKey.set(r.indicatorKey, r);
  }
  const n = (v: string | null) => (v == null ? null : Number(v));

  return INDICATORS.map((spec): TrackedIndicator => {
    const r = byKey.get(spec.key);
    const releaseDate = r?.releaseDate ? r.releaseDate.toISOString() : null;
    const fetchedAt = r?.fetchedAt ? r.fetchedAt.toISOString() : null;
    const live = r?.live ?? false;
    return {
      key: spec.key, label: spec.label, unit: spec.unit, goodIfUp: spec.goodIfUp,
      group: spec.group, feasibility: spec.feasibility, cadenceLabel: spec.cadenceLabel,
      source: spec.source, caveat: spec.caveat,
      observedValue: r ? n(r.observedValue) : null,
      refYear: r?.refYear ?? null,
      refPeriodLabel: r?.refPeriodLabel ?? null,
      releaseDate, fetchedAt, live,
      provenanceNote: r?.provenanceNote ?? null,
      projectedBaseline: r ? n(r.projectedBaseline) : null,
      projectedPolicy: r ? n(r.projectedPolicy) : null,
      statusVsBaseline: (r?.statusVsBaseline as TrackedIndicator['statusVsBaseline']) ?? 'no-data',
      statusVsPolicy: (r?.statusVsPolicy as TrackedIndicator['statusVsPolicy']) ?? 'no-data',
      freshness: freshnessState({ releaseDate, fetchedAt, live, expectedReleaseMonths: spec.expectedReleaseMonths, now }),
    };
  });
}
