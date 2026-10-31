// Does this listing meet the ask? PURE: specs and a price in, a verdict and one
// reason per constraint out. Code decides; the reasons are what the page and
// the alert show, so "why did it tell me about this" always has an answer.
//
//   match    — every constraint passes and the price is at or under the ceiling
//   possible — nothing fails, but the listing is silent on something we asked
//              (deal titles often say "16GB RAM" without the DDR generation)
//   near     — specs all pass; price over the ceiling by no more than nearMissPct
//   no       — anything fails

import { gpuScore } from './gpu';
import { readSpecs, type Specs } from './specs';
import type { Constraint, ConstraintResult, Evaluation, WishCriteria } from './types';

export function formatPence(p: number): string {
  const pounds = p / 100;
  return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function checkOne(c: Constraint, specs: Specs, text: string): ConstraintResult {
  switch (c.field) {
    case 'gpu': {
      const want = gpuScore(c.value);
      if (!specs.gpu) return { field: 'gpu', ok: null, reason: `GPU not stated (want ${c.value} or better)` };
      if (specs.gpu.laptop) return { field: 'gpu', ok: false, reason: `${specs.gpu.name} is a laptop part` };
      if (want === null) return { field: 'gpu', ok: null, reason: `${c.value} is not in the GPU ranking` };
      if (specs.gpu.score === null) return { field: 'gpu', ok: null, reason: `${specs.gpu.name} is not in the GPU ranking` };
      return specs.gpu.score >= want
        ? { field: 'gpu', ok: true, reason: `${specs.gpu.name} ≥ ${c.value}` }
        : { field: 'gpu', ok: false, reason: `${specs.gpu.name} is below ${c.value}` };
    }
    case 'ram_gb':
      if (specs.ramGb === null) return { field: 'ram_gb', ok: null, reason: `RAM size not stated (want ${c.value}GB+)` };
      return specs.ramGb >= c.value
        ? { field: 'ram_gb', ok: true, reason: `${specs.ramGb}GB RAM` }
        : { field: 'ram_gb', ok: false, reason: `${specs.ramGb}GB RAM, under ${c.value}GB` };
    case 'storage_gb':
      if (specs.storageGb === null) return { field: 'storage_gb', ok: null, reason: `Storage not stated (want ${c.value}GB+)` };
      return specs.storageGb >= c.value
        ? { field: 'storage_gb', ok: true, reason: `${specs.storageGb >= 1000 ? specs.storageGb / 1000 + 'TB' : specs.storageGb + 'GB'} storage` }
        : { field: 'storage_gb', ok: false, reason: `${specs.storageGb}GB storage, under ${c.value}GB` };
    case 'ram_type': {
      const want = c.value.map((v) => v.toUpperCase());
      if (!specs.ramType) return { field: 'ram_type', ok: null, reason: `RAM type not stated (want ${want.join('/')})` };
      return want.includes(specs.ramType)
        ? { field: 'ram_type', ok: true, reason: specs.ramType }
        : { field: 'ram_type', ok: false, reason: `${specs.ramType}, not ${want.join('/')}` };
    }
    case 'text': {
      const lower = text.toLowerCase();
      const hits = c.value.filter((w) => lower.includes(w.toLowerCase()));
      if (c.op === 'contains_any') {
        return hits.length
          ? { field: 'text', ok: true, reason: `mentions ${hits[0]}` }
          : { field: 'text', ok: false, reason: `does not mention ${c.value.join(' / ')}` };
      }
      return hits.length
        ? { field: 'text', ok: false, reason: `mentions ${hits[0]}` }
        : { field: 'text', ok: true, reason: `no ${c.value.join(' / ')}` };
    }
  }
}

export function evaluate(
  listing: { title: string; description: string; pricePence: number | null },
  criteria: WishCriteria,
): Evaluation {
  const specs = readSpecs(listing.title, listing.description);
  const text = `${listing.title}\n${listing.description}`;
  const results = criteria.constraints.map((c) => checkOne(c, specs, text));

  let priceOk: boolean | null = true;
  let priceNear = false;
  if (criteria.maxPricePence !== null) {
    if (listing.pricePence === null) {
      priceOk = null;
      results.unshift({ field: 'price', ok: null, reason: 'Price not stated' });
    } else if (listing.pricePence <= criteria.maxPricePence) {
      results.unshift({ field: 'price', ok: true, reason: `${formatPence(listing.pricePence)} ≤ ${formatPence(criteria.maxPricePence)}` });
    } else {
      priceOk = false;
      const over = listing.pricePence - criteria.maxPricePence;
      priceNear = over <= criteria.maxPricePence * (criteria.nearMissPct / 100);
      results.unshift({ field: 'price', ok: false, reason: `${formatPence(listing.pricePence)}, ${formatPence(over)} over` });
    }
  }

  const specResults = results.filter((r) => r.field !== 'price');
  if (specResults.some((r) => r.ok === false)) return { verdict: 'no', results };
  // Silence is only benefit-of-the-doubt for a DETAIL. A listing that does not
  // name the GPU you asked for is not a gaming PC we can vouch for — the first
  // live run (2026-10-31) offered Mac minis, all-in-ones and handhelds as
  // "possible" on exactly that gap — and two unstated specs is a guess.
  const unknown = specResults.filter((r) => r.ok === null);
  if (unknown.some((r) => r.field === 'gpu') || unknown.length > 1) return { verdict: 'no', results };
  const silent = unknown.length === 1;
  if (priceOk === false) return { verdict: priceNear && !silent ? 'near' : 'no', results };
  if (priceOk === null || silent) return { verdict: 'possible', results };
  return { verdict: 'match', results };
}

/** The ones worth telling someone about, best first. */
export const ALERTABLE: readonly string[] = ['match', 'near', 'possible'];
export function verdictRank(v: string): number {
  return v === 'match' ? 0 : v === 'possible' ? 1 : v === 'near' ? 2 : 3;
}

/** One constraint in words, for the page: "RTX 5060 or better", "16GB+ RAM". */
export function describeConstraint(c: import('./types').Constraint): string {
  switch (c.field) {
    case 'gpu':
      return `${c.value} or better`;
    case 'ram_gb':
      return `${c.value}GB+ RAM`;
    case 'storage_gb':
      return `${c.value >= 1000 ? c.value / 1000 + 'TB' : c.value + 'GB'}+ storage`;
    case 'ram_type':
      return c.value.join(' / ');
    case 'text':
      return c.op === 'contains_any' ? `mentions ${c.value.join(' / ')}` : `not ${c.value.join(' / ')}`;
  }
}
