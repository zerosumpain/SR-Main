// The checks run after every town-month (spec §10.4 item 9, §5.20): stocks
// finite and non-negative, people and pounds whole, indices in range, and the
// books balanced (reserves = month open + Σ postings, head-count = month open
// + Σ population flows). On a failure the driver reverts the town to its
// pre-month state, skips the month and writes an alert: one broken town never
// stops the county.

import { population } from './core';
import { CARRY_SCALE } from './num';
import { COHORT_COUNT, METERS, PEOPLE_COUNT, STAR_COUNT, type CountyState, type TownState } from './types';

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Problems with one town (empty = healthy). */
export function checkTown(t: TownState): string[] {
  const out: string[] = [];
  const whole = (name: string, xs: readonly number[], len?: number) => {
    if (len !== undefined && xs.length !== len) out.push(`${name} has ${xs.length} entries, not ${len}`);
    xs.forEach((x, i) => {
      if (!finite(x) || x < 0 || !Number.isInteger(x)) out.push(`${name}[${i}] = ${String(x)}`);
    });
  };
  const ranged = (name: string, xs: readonly number[], lo: number, hi: number, len?: number) => {
    if (len !== undefined && xs.length !== len) out.push(`${name} has ${xs.length} entries, not ${len}`);
    xs.forEach((x, i) => {
      if (!finite(x) || x < lo || x > hi) out.push(`${name}[${i}] = ${String(x)} outside ${lo}..${hi}`);
    });
  };
  whole('people', t.people, PEOPLE_COUNT);
  whole('applicants', t.applicants, COHORT_COUNT);
  whole('aspirants', t.aspirants, 2);
  whole('longUnemployed', t.longUnemployed, 3);
  whole('squeezed', [t.squeezed]);
  ranged('meters', t.meters, -100, 100, METERS.length);
  ranged('perceived', t.perceived, 0, 100, STAR_COUNT);
  ranged('happy', t.happy, 0, 100, COHORT_COUNT);
  ranged('approval', [t.approval], 0, 100);
  ranged('aw', [t.aw], 0, 1);
  ranged('soft stocks', [t.culture, t.edu, t.rep, t.ps], 0, Number.MAX_VALUE);
  ranged('goodsStock', t.goodsStock, 0, Number.MAX_VALUE, 2);
  t.margins.forEach((m, i) => {
    if (!finite(m)) out.push(`margins[${i}] = ${String(m)}`);
  });
  const r = t.money.reserves;
  if (!finite(r) || !Number.isInteger(r)) out.push(`reserves = ${String(r)}`);
  let posted = 0;
  for (const x of t.books.lines) {
    if (!finite(x) || !Number.isInteger(x)) out.push(`ledger line ${String(x)} is not whole`);
    posted += x;
  }
  if (finite(r) && t.books.open + posted !== r) out.push(`ledger unbalanced: open ${t.books.open} + posted ${posted} ≠ reserves ${r}`);
  let moved = 0;
  for (const x of t.books.pop) moved += x;
  const n = population(t);
  if (t.books.popOpen + moved !== n) out.push(`people not conserved: open ${t.books.popOpen} + flows ${moved} ≠ population ${n}`);
  for (const k of Object.keys(t.carry)) {
    const c = t.carry[k];
    if (!finite(c) || !Number.isInteger(c) || Math.abs(c) >= CARRY_SCALE) out.push(`carry ${k} = ${String(c)}`);
  }
  if (!Number.isInteger(t.tick) || t.tick < 0) out.push(`tick = ${String(t.tick)}`);
  for (const b of t.buildings) if (b.some((x) => !finite(x))) out.push(`building record ${JSON.stringify(b)}`);
  return out;
}

/** Problems anywhere in a county. */
export function checkCounty(c: CountyState): string[] {
  const out: string[] = [];
  c.towns.forEach((t, i) => {
    for (const p of checkTown(t)) out.push(`town ${i}: ${p}`);
  });
  if (!finite(c.fund) || c.fund < 0) out.push(`fund = ${String(c.fund)}`);
  for (const x of c.ledger) if (!finite(x) || x < 0) out.push(`intent ${String(x)}`);
  return out;
}
