// tracking/types.ts — the live-data observation layer for The Whitehall Model.
// These types describe how each model indicator maps to an official live source, how
// reality is compared against the model's projections, and how fresh the data is.
// Self-contained within the policy-engine route.

import type { YearResult } from '../types';

/** How reachable the live counterpart is (drives effort + honesty flags in the UI). */
export type Feasibility =
  | 'wired'      // a live API endpoint already exists in this repo
  | 'api-ready'  // public programmatic API (EES / ONS / World Bank), wired here
  | 'csv-bulk'   // downloadable spreadsheet only
  | 'scrape'     // publication-page scrape only
  | 'manual'     // PDF / human read — documented, not auto-fetched
  | 'model-only';// no real-world counterpart (synthetic / counterfactual)

/** Reality vs a projected trajectory for one indicator/year. */
export type TrackStatus = 'on-track' | 'off-track' | 'no-data';

/** Freshness of the most recent observation relative to its expected cadence. */
export type FreshnessState = 'fresh' | 'due' | 'stale' | 'no-data' | 'snapshot';

/** Which cron workflow group refreshes this indicator. */
export type TrackGroup = 'ees' | 'neet' | 'context' | 'annual';

export interface TimePeriod {
  code: 'AY' | 'CY' | 'FY';
  period: string; // e.g. '2024/2025' (AY) or '2024' (CY)
}

/** An EES data-set query recipe: one indicator pulled with every filter pinned. */
export interface EesFetch {
  kind: 'ees';
  datasetGuid: string;
  publicationSlug: string; // for release-detection via the publications feed
  timePeriod: TimePeriod;
  indicatorId: string;
  /** filter column id -> option id; EVERY filter column on the dataset must be present. */
  filters: Record<string, string>;
}

export interface OnsNeetFetch {
  kind: 'ons-neet-xlsx';
  /** which Aged-16-24 column to read from Table NEET 1. */
  field: 'rate' | 'level' | 'unemployed' | 'inactive';
}

export interface WorldBankFetch {
  kind: 'worldbank';
  indicator: string; // e.g. 'NY.GDP.PCAP.PP.CD'
  country: string;   // ISO3, e.g. 'GBR'
}

/** Observed value computed in-memory from other already-fetched indicator keys. */
export interface DerivedFetch {
  kind: 'derived';
  from: string[]; // indicator keys this depends on
  combine: (vals: Record<string, number>) => number;
}

/** Documented but not auto-fetched in v1 (key-gated / PDF / bulk). */
export interface ManualFetch {
  kind: 'manual';
}

export type FetchSpec =
  | EesFetch
  | OnsNeetFetch
  | WorldBankFetch
  | DerivedFetch
  | ManualFetch;

/** Pull the model's projected value for this indicator out of a simulated year. */
export type ProjectionFn = (y: YearResult) => number | null;

export interface IndicatorSpec {
  /** Stable key; for engine-mapped indicators this equals the YearResult field name. */
  key: string;
  label: string;
  unit: string;
  /** Higher is better? Drives status colouring + the on-track/off-track direction. */
  goodIfUp: boolean;
  group: TrackGroup;
  feasibility: Feasibility;
  /** Real-world release cadence (months a fresh release is expected, 1-12) — for freshness. */
  expectedReleaseMonths: number[];
  /** Plain-English cadence label shown in the UI. */
  cadenceLabel: string;
  source: { publisher: string; name: string; url: string };
  /** How to obtain the observed value. */
  fetch: FetchSpec;
  /**
   * How to read the model's projection for a given year. Omit for observed-only
   * indicators (e.g. NEET 16-17, international comparators) that have no engine field.
   */
  projection?: ProjectionFn;
  /** Honesty caveat surfaced in the UI (e.g. survey volatility, batch-not-realtime). */
  caveat?: string;
}

/** Shape returned to the UI for one indicator (snapshot row + derived display fields). */
export interface TrackedIndicator {
  key: string;
  label: string;
  unit: string;
  goodIfUp: boolean;
  group: TrackGroup;
  feasibility: Feasibility;
  cadenceLabel: string;
  source: { publisher: string; name: string; url: string };
  caveat?: string;
  // observation (null when not yet tracked)
  observedValue: number | null;
  refYear: number | null;
  refPeriodLabel: string | null;
  releaseDate: string | null; // ISO
  fetchedAt: string | null;   // ISO
  live: boolean;
  provenanceNote: string | null;
  // projections at refYear
  projectedBaseline: number | null;
  projectedPolicy: number | null;
  statusVsBaseline: TrackStatus;
  statusVsPolicy: TrackStatus;
  freshness: FreshnessState;
}
