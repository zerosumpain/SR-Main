// The §10.15 CPU budgets, measured the way production runs the engine:
// this file bundles itself with esbuild and reruns in a plain Node child (a
// per-file loader or a test runner's module shim is markedly slower, and
// would measure the shim). Spec §12.1 item 7.
//
//   npx tsx scripts/hometowns/bench.ts                 # print the table
//   npx tsx scripts/hometowns/bench.ts --check         # exit 1 if a p95 is over 2× its budget (§10.15's CI margin)
//   npx tsx scripts/hometowns/bench.ts --days 3        # longer county run for the Regional Day and chunks
//
// What it times:
//   - tick and month step: the Metropolis fixture town, tick after tick as
//     catch-up runs them (a month step is the tick that ends a month, minus
//     a plain tick);
//   - Regional Day and catch-up chunks: a county of six towns copied from
//     the Town fixture, caught up a day at a time in the server's 96-unit
//     chunks, with each Regional Day timed on its own.
// Run it on a quiet machine: the numbers are wall-clock times. The Lab's G12
// reports the same budgets from bot counties (timed alone, after its pool).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture';
import { BUDGETS } from './lab/gates';
import { gridTickAt, nextRegionalDayAt } from '../../src/lib/games/hometowns/engine/clock';
import { catchUp, foundTown, regionalDay } from '../../src/lib/games/hometowns/engine/county';
import { advanceTown, catchUpTown, makeContext } from '../../src/lib/games/hometowns/engine/tick';
import type { CountyState, TownState } from '../../src/lib/games/hometowns/engine/types';

const CHILD = 'HOMETOWNS_BENCH_CHILD';
const MARGIN = 2;

interface Row {
  step: string;
  n: number;
  median: number;
  p95: number;
  max: number;
  budget: number;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
const row = (step: string, xs: number[], budget: number): Row => ({ step, n: xs.length, median: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: quantile(xs, 1), budget });

/** Plain ticks and month steps of the Metropolis fixture, after a warm-up. */
function benchTicks(months: number): { tick: number[]; month: number[] } {
  const f = fixture('metropolis');
  const c = f.county;
  const t = c.towns[f.town];
  const tick: number[] = [];
  const whole: number[] = [];
  for (let k = 0; k < (months + 10) * 4; k++) {
    const ctx = makeContext(c, f.town, t.tick);
    const monthEnd = t.tick % 4 === 3;
    const s = performance.now();
    advanceTown(t, ctx); // as catch-up runs it: the planes are written back once a chunk
    const ms = performance.now() - s;
    if (k < 40) continue;
    (monthEnd ? whole : tick).push(ms);
  }
  const plain = quantile(tick, 0.5);
  return { tick, month: whole.map((x) => Math.max(0, x - plain)) };
}

/** Six towns copied from the Town fixture (each on its own site, with its own seat). */
function sixTowns(): { c: CountyState; now: number } {
  const f = fixture('town');
  const c = f.county;
  const proto = c.towns[f.town];
  for (let k = 0; c.towns.length < 6 && k < c.sites.length; k++) {
    if (c.sites[k].owner !== null) continue;
    const seat = `bench-${k}`;
    const t = foundTown(c, seat, { site: k, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: k }, f.now);
    const copy = JSON.parse(JSON.stringify(proto)) as TownState;
    Object.assign(t, copy, { seat, ownerId: seat, site: k, seed: t.seed });
  }
  return { c, now: f.now };
}

function benchCounty(days: number): { regional: number[]; chunk: number[] } {
  const { c, now } = sixTowns();
  const regional: number[] = [];
  const chunk: number[] = [];
  void now;
  for (let d = 0; d < days; d++) {
    const R = nextRegionalDayAt(c);
    // Chunks up to just before the Regional Day, then the day on its own, then on.
    for (;;) {
      const s = performance.now();
      const r = catchUp(c, R - 1, 96);
      chunk.push(performance.now() - s);
      if (r.done) break;
    }
    // The last ticks before the instant are tick work, not the day's: run them untimed.
    for (let i = 0; i < c.towns.length; i++) catchUpTown(c, i, gridTickAt(c, R));
    const s = performance.now();
    regionalDay(c, c.dayIndex);
    regional.push(performance.now() - s);
  }
  return { regional, chunk };
}

function measure(days: number): Row[] {
  const ticks = benchTicks(60);
  const county = benchCounty(days);
  return [
    row('Tick (development scan and pipeline)', ticks.tick, BUDGETS.tickMs),
    row('Month step, including transport', ticks.month, BUDGETS.monthMs),
    row('Regional Day, 6 towns', county.regional, BUDGETS.regionalMs),
    row('Catch-up chunk (96 units)', county.chunk, BUDGETS.chunkMs),
  ];
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const k = args.indexOf('--days');
  const days = k >= 0 ? Number(args[k + 1]) : 2;
  if (process.env[CHILD] === '1') {
    console.log(JSON.stringify(measure(days)));
    return 0;
  }
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'hometowns-bench-'));
  let rows: Row[];
  try {
    const out = join(dir, 'bench.mjs');
    await esbuild.build({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
    rows = JSON.parse(execFileSync(process.execPath, [out, ...args], { encoding: 'utf8', timeout: 600_000, env: { ...process.env, [CHILD]: '1' }, cwd: dirname(fileURLToPath(import.meta.url)) }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const f = (x: number) => x.toFixed(3).padStart(9);
  console.log(`${'step'.padEnd(40)} ${'n'.padStart(6)} ${'median'.padStart(9)} ${'p95'.padStart(9)} ${'max'.padStart(9)}  budget (p95, ms)`);
  let over = 0;
  for (const r of rows) {
    const bad = r.p95 > r.budget * MARGIN;
    if (bad) over++;
    console.log(`${r.step.padEnd(40)} ${String(r.n).padStart(6)} ${f(r.median)} ${f(r.p95)} ${f(r.max)}  ${r.budget}${bad ? `  OVER ${MARGIN}× budget` : r.p95 > r.budget ? '  over budget, inside the CI margin' : ''}`);
  }
  if (args.includes('--check') && over) {
    console.error(`${over} step(s) over ${MARGIN}× their §10.15 budget`);
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code));
