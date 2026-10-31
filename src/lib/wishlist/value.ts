// Comparing listings side by side: the specs each one states, and a composite
// value-for-money index. PURE — the page computes it at load from stored
// offers, so changing a weight here re-scores every listing without a sweep.
//
// The index is performance per pound, scaled so the best listing on the item
// scores 100. Performance is a weighted mean of the parts a listing STATES,
// each measured against a reference build (RTX 5060, Ryzen 5 7600, 16GB RAM,
// 1TB storage — each scores 1.0):
//
//   GPU 55% · CPU 20% · RAM 15% · storage 10%
//
// GPU dominates because a gaming PC's frame rate is mostly its GPU's. RAM and
// storage are capped at twice the reference — 64GB does not make a game run
// four times faster than 16GB. A part the listing does not state is scored as
// a MODEST one (UNSTATED below — a CPU three-quarters of the reference, 8GB,
// 512GB), never left out: leaving it out let a cheap listing that hid its CPU
// outscore one that named a good one (seen on the first live run). The row
// also says how much of the weight was actually stated. With no GPU stated
// there is no index at all: the GPU is most of the answer.

import { formatPence } from './match';
import { readSpecs } from './specs';
import type { WishOffer } from './types';

const REF = { gpu: 43, cpu: 65, ramGb: 16, storageGb: 1000 };
/** What an unstated part counts as, against the reference (1.0). */
const UNSTATED = { cpu: 0.75, ram: 0.5, storage: 0.5 };
export const WEIGHTS = { gpu: 0.55, cpu: 0.2, ram: 0.15, storage: 0.1 } as const;

export interface CompareRow {
  key: string;
  title: string;
  url: string;
  merchant: string | null;
  pricePence: number;
  priceLabel: string;
  verdict: WishOffer['verdict'];
  gpu: string | null;
  gpuScore: number | null;
  cpu: string | null;
  cpuScore: number | null;
  ramGb: number | null;
  ramType: string | null;
  storageGb: number | null;
  /** Performance against the reference build (1.0 = the reference), or null. */
  perf: number | null;
  /** Share of the weight the listing actually states, 0–1 (the rest is scored as UNSTATED). */
  coverage: number;
  /** Best listing on the item = 100. */
  value: number | null;
}

export function compareRow(o: WishOffer): Omit<CompareRow, 'value'> {
  const s = readSpecs(o.title, o.description);
  const gpuScore = s.gpu?.score ?? null;
  const cpuScore = s.cpu?.score ?? null;
  const parts: [number, number | null, number][] = [
    [WEIGHTS.cpu, cpuScore === null ? null : cpuScore / REF.cpu, UNSTATED.cpu],
    [WEIGHTS.ram, s.ramGb === null ? null : Math.min(s.ramGb / REF.ramGb, 2), UNSTATED.ram],
    [WEIGHTS.storage, s.storageGb === null ? null : Math.min(s.storageGb / REF.storageGb, 2), UNSTATED.storage],
  ];
  const coverage = WEIGHTS.gpu + parts.reduce((n, [w, v]) => n + (v === null ? 0 : w), 0);
  const perf =
    gpuScore === null ? null : WEIGHTS.gpu * (gpuScore / REF.gpu) + parts.reduce((n, [w, v, unstated]) => n + w * (v ?? unstated), 0);
  return {
    key: o.key,
    title: o.title,
    url: o.url,
    merchant: o.merchant,
    pricePence: o.pricePence,
    priceLabel: formatPence(o.pricePence),
    verdict: o.verdict,
    gpu: s.gpu?.name ?? null,
    gpuScore,
    cpu: s.cpu?.name ?? null,
    cpuScore,
    ramGb: s.ramGb,
    ramType: s.ramType,
    storageGb: s.storageGb,
    perf: perf === null ? null : Math.round(perf * 100) / 100,
    coverage: Math.round(coverage * 100) / 100,
  };
}

/** Rows for every offer, with the value index relative to the best of them. */
export function compareRows(offers: WishOffer[]): CompareRow[] {
  const rows = offers.map(compareRow);
  const perPound = (r: Omit<CompareRow, 'value'>) => (r.perf === null || r.pricePence <= 0 ? null : r.perf / r.pricePence);
  const best = Math.max(0, ...rows.map((r) => perPound(r) ?? 0));
  return rows.map((r) => {
    const v = perPound(r);
    return { ...r, value: v === null || best === 0 ? null : Math.round((v / best) * 100) };
  });
}
