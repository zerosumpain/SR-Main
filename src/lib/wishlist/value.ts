// Comparing listings side by side: what each one states about the things that
// matter for THIS item, and a composite value-for-money index. PURE — the page
// computes it at load from stored offers, so changing a weight re-scores every
// listing without a sweep.
//
// What matters is the item's own `criteria.value` — chosen once, when the ask
// is read: a TV weighs screen size and refresh rate, a holiday nights and
// stars, a PC its GPU and CPU. Each factor scores value/ref (ref/value when
// lower is better), capped at 2× — a 98in TV is not twice the value of a 55in
// one to someone who asked for 55 — times its weight. The index is that
// performance per pound, scaled so the best listing on the item scores 100.
//
// A factor a listing does not state scores UNSTATED (half the reference),
// never left out: leaving it out let a cheap listing that hid its CPU outscore
// one that named a good one (first live run, 2026-10-31). If it does not state
// the heaviest factor there is no index at all — that factor is most of the
// answer. An item with no factors (a specific LEGO set) is compared on price
// alone: the cheapest scores 100.

import { parseCpu } from './cpu';
import { formatPence, comparablePrice } from './match';
import { readSpecs } from './specs';
import { formatUnit, readUnit } from './units';
import { formatSpan, readTravelDates } from './dates';
import type { ValueFactor, WishCriteria, WishOffer } from './types';

const UNSTATED = 0.5;
const CAP = 2;

/**
 * The PC value model, for a PC item compiled before items carried their own
 * (and the fallback for any ask that names a GPU): GPU 55, CPU 20, RAM 15,
 * storage 10, against an RTX 5060 / Ryzen 5 7600 / 16GB / 1TB build.
 */
export const PC_VALUE: ValueFactor[] = [
  { label: 'GPU', measure: 'gpu', weight: 0.55, ref: 43, better: 'higher' },
  { label: 'CPU', measure: 'cpu', weight: 0.2, ref: 65, better: 'higher' },
  { label: 'RAM', measure: 'ram_gb', weight: 0.15, ref: 16, better: 'higher' },
  { label: 'Storage', measure: 'storage_gb', weight: 0.1, ref: 1000, better: 'higher' },
];

/**
 * The factors an item is scored on. An ask with a GPU rule is a PC, and a PC
 * is scored on PC_VALUE whatever the model offered: on the first live run it
 * offered storage alone, which ranked a PC by its SSD.
 */
export function valueModel(criteria: WishCriteria): ValueFactor[] {
  if (criteria.constraints.some((c) => c.field === 'gpu')) return PC_VALUE;
  return criteria.value ?? [];
}

export interface FactorReading {
  label: string;
  /** What the listing states, for the cell: "RTX 5060", "55in", "4★". */
  shown: string | null;
  /** The ranking score under a GPU/CPU name. */
  sub: string | null;
  /** Against the reference (1.0 = typical good), for sorting; null = unstated. */
  score: number | null;
}

export interface CompareRow {
  key: string;
  title: string;
  url: string;
  merchant: string | null;
  pricePence: number;
  /** The price held against the budget — × party for a per-person price. */
  comparePence: number;
  priceLabel: string;
  priceNote: string;
  verdict: WishOffer['verdict'];
  factors: FactorReading[];
  /** Trips only: the dates the listing states ("12 Jan–17 Jan", "Dec 2026 · other dates"). */
  when: string | null;
  /** Performance against the reference (1.0), or null. */
  perf: number | null;
  /** Share of the weight the listing actually states, 0–1. */
  coverage: number;
  /** Best listing on the item = 100. */
  value: number | null;
}

const cpuLabel = (c: string) => c.replace(/^RYZEN /, 'Ryzen ').replace(/^ULTRA /, 'Core Ultra ');

function readFactor(f: ValueFactor, title: string, description: string): { raw: number | null; reading: Omit<FactorReading, 'score'> } {
  const label = f.label;
  switch (f.measure) {
    case 'gpu': {
      const g = readSpecs(title, description).gpu;
      return { raw: g?.score ?? null, reading: { label, shown: g?.name ?? null, sub: g?.score != null ? `score ${g.score}` : null } };
    }
    case 'cpu': {
      const c = parseCpu(title, description);
      return { raw: c?.score ?? null, reading: { label, shown: c ? cpuLabel(c.name) : null, sub: c?.score != null ? `score ${c.score}` : null } };
    }
    case 'ram_gb': {
      const s = readSpecs(title, description);
      return { raw: s.ramGb, reading: { label, shown: s.ramGb === null ? null : `${s.ramGb}GB`, sub: s.ramType } };
    }
    case 'storage_gb': {
      const gb = readSpecs(title, description).storageGb;
      return { raw: gb, reading: { label, shown: gb === null ? null : formatUnit('gb', gb), sub: null } };
    }
    default: {
      const n = readUnit(f.measure, title, description);
      return { raw: n, reading: { label, shown: n === null ? null : formatUnit(f.measure, n), sub: null } };
    }
  }
}

function score(f: ValueFactor, raw: number): number {
  if (raw <= 0 || f.ref <= 0) return 0;
  return Math.min(f.better === 'higher' ? raw / f.ref : f.ref / raw, CAP);
}

export function compareRow(o: WishOffer, criteria: WishCriteria): Omit<CompareRow, 'value'> {
  const model = valueModel(criteria);
  const heaviest = model.reduce<ValueFactor | null>((h, f) => (!h || f.weight > h.weight ? f : h), null);
  const total = model.reduce((n, f) => n + f.weight, 0);
  let perf = 0;
  let stated = 0;
  let missingKey = false;
  const factors: FactorReading[] = [];
  for (const f of model) {
    const { raw, reading } = readFactor(f, o.title, o.description);
    factors.push({ ...reading, score: raw === null ? null : Math.round(score(f, raw) * 100) / 100 });
    if (raw === null) {
      if (f === heaviest) missingKey = true;
      perf += f.weight * UNSTATED;
    } else {
      perf += f.weight * score(f, raw);
      stated += f.weight;
    }
  }
  const { pence, note } = comparablePrice(o, criteria);
  let when: string | null = null;
  if (criteria.constraints.some((c) => c.field === 'dates')) {
    const read = readTravelDates(o.title, o.description, new Date(o.firstSeenAt || Date.now()));
    when = [[...new Set(read.spans.map(formatSpan))].slice(0, 2).join(', '), read.flexible ? 'other dates' : ''].filter(Boolean).join(' · ') || null;
  }
  const comparePence = pence ?? o.pricePence;
  return {
    key: o.key,
    title: o.title,
    url: o.url,
    merchant: o.merchant,
    pricePence: o.pricePence,
    comparePence,
    // The column shows what is held against the budget; a per-person price
    // shows its working underneath ("£100pp × 2").
    priceLabel: formatPence(comparePence),
    priceNote: note.trim().replace(/^\((.*)\)$/, '$1').replace(/^pp$/, 'per person'),
    verdict: o.verdict,
    factors,
    when,
    // No model: every listing is "1.0" and the index is price alone.
    perf: total === 0 ? 1 : missingKey ? null : Math.round((perf / total) * 100) / 100,
    coverage: total === 0 ? 1 : Math.round((stated / total) * 100) / 100,
  };
}

/** Rows for every offer, with the value index relative to the best of them. */
export function compareRows(offers: WishOffer[], criteria: WishCriteria): CompareRow[] {
  const rows = offers.map((o) => compareRow(o, criteria));
  const perPound = (r: Omit<CompareRow, 'value'>) => (r.perf === null || r.comparePence <= 0 ? null : r.perf / r.comparePence);
  const best = Math.max(0, ...rows.map((r) => perPound(r) ?? 0));
  return rows.map((r) => {
    const v = perPound(r);
    return { ...r, value: v === null || best === 0 ? null : Math.round((v / best) * 100) };
  });
}
