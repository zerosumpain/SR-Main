// The Hometowns balance Lab (spec §11): bot mayors play real counties on the
// real engine, headless, across many seeds, and the gates of §11.4 judge the
// result. Clean-room: written for this game, sharing only lessons (no code)
// with earlier tools.
//
//   npx tsx scripts/hometowns/lab.ts --quick                 # the tuning loop (≤ 90 s target)
//   npx tsx scripts/hometowns/lab.ts --full                  # the gate run: 200 seeds × 60 days × 6-bot counties
//   npx tsx scripts/hometowns/lab.ts --smoke                 # §12.1's 12 seeds × 20 days × 4 towns
//   npx tsx scripts/hometowns/lab.ts --quick --baseline write   # set this profile's baseline
//   npx tsx scripts/hometowns/lab.ts --full --check          # exit 1 on a gate failure or a baseline regression
//   npx tsx scripts/hometowns/lab.ts --quick --ab change.json   # paired A/B of a params change on the same seeds
//   npx tsx scripts/hometowns/lab.ts --sweep targets         # ±20% on §11.3's first targets (or: --sweep all)
//   npx tsx scripts/hometowns/lab.ts --offrule               # off-rule identity runs
//
// Options: --seeds N, --days N, --workers N (0 = in this thread), --no-report.
// Reports go to scripts/hometowns/reports/<stamp>-<profile>/ (git-ignored),
// with latest.html and latest.json beside them.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadBaseline, makeBaseline, writeBaseline, baselinePath } from './lab/baseline';
import type { Profile } from './lab/experiments';
import { defaultWorkers } from './lab/pool';
import { writeReport } from './lab/report';
import { FIRST_TARGETS, offRuleReport, runAb, runLab, runSweep } from './lab/runner';
import type { Scorecard } from './lab/summary';
import { parseVariant } from './lab/variant';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
const has = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string) => (arg(name) ? Number(arg(name)) : undefined);
const log = (s: string) => console.error(s);

function summarise(s: Scorecard): void {
  console.log(`\nHometowns Lab · ${s.profile} · ${s.config.seeds} seeds × ${s.config.days} days · ${s.townDays} town-days in ${(s.wallMs / 1000).toFixed(1)} s`);
  console.log(`verdict ${s.verdict.toUpperCase()} · M0 exit ${s.m0.toUpperCase()}`);
  for (const g of s.gates) {
    const failed = g.checks.filter((c) => c.ok === false && !c.provisional).map((c) => `${c.name} = ${typeof c.value === 'number' ? Math.round(c.value * 1000) / 1000 : c.value} (target ${c.target})`);
    console.log(`  ${g.id.padEnd(4)} ${g.verdict.padEnd(7)} ${g.title}${failed.length ? `\n         ✗ ${failed.join('\n         ✗ ')}` : ''}`);
  }
  for (const b of s.bots) console.log(`  ${b.bot.padEnd(11)} n=${String(b.n).padEnd(4)} pop ${Math.round(b.finalPop.est)} happy ${b.happy} days ${b.tierDays.map((d) => d ?? '—').join('/')}`);
  if (s.regressions) console.log(s.regressions.length ? `regressions:\n  ${s.regressions.join('\n  ')}` : 'no regressions against the baseline');
}

async function main(): Promise<number> {
  const profile: Profile = has('full') ? 'full' : has('smoke') ? 'smoke' : 'quick';
  const workers = num('workers') ?? defaultWorkers();
  const report = !has('no-report');

  if (has('sweep')) {
    const which = arg('sweep') || 'targets';
    const paths = which === 'all' ? undefined : which === 'targets' ? FIRST_TARGETS : which.split(',');
    const t0 = performance.now();
    const sweep = await runSweep({ paths, seeds: num('seeds') ?? 2, days: num('days') ?? 10, workers, log });
    const { scorecard } = await runLab({ profile: 'smoke', seeds: 1, days: 1, workers, baseline: null });
    scorecard.sweep = sweep;
    scorecard.profile = 'sweep';
    scorecard.wallMs = performance.now() - t0;
    for (const r of sweep.rows) if (r.fragile || r.dead) console.log(`${r.fragile ? 'FRAGILE' : 'dead   '} ${r.path} ×0.8 ${JSON.stringify(r.down)} ×1.2 ${JSON.stringify(r.up)}`);
    console.log(`${sweep.rows.length} parameters swept: ${sweep.rows.filter((r) => r.fragile).length} fragile, ${sweep.rows.filter((r) => r.dead).length} dead`);
    if (report) console.log(`report: ${writeReport(scorecard)}/index.html`);
    return 0;
  }

  if (has('offrule')) {
    const rows = offRuleReport();
    for (const r of rows) console.log(`${r.status.padEnd(9)} ${r.system.padEnd(11)} ${r.firstDivergence ?? ''} ${r.note}`);
    return rows.some((r) => r.status === 'fail') ? 1 : 0;
  }

  const base = { profile, seeds: num('seeds'), days: num('days'), workers, log };
  let scorecard: Scorecard;
  if (arg('ab') !== undefined) {
    const file = arg('ab')!;
    const variant = parseVariant(JSON.parse(readFileSync(file, 'utf8')), basename(file).replace(/\.json$/, ''));
    const { base: b, alt, ab } = await runAb({ ...base, variant });
    scorecard = b;
    for (const m of ab.metrics) console.log(`${m.name.padEnd(22)} base ${m.base} → ${m.variant}  Δ ${Math.round(m.diff.est * 100) / 100} [${Math.round(m.diff.lo * 100) / 100}, ${Math.round(m.diff.hi * 100) / 100}]`);
    if (report) console.log(`variant report: ${writeReport(alt)}/index.html`);
  } else {
    scorecard = (await runLab(base)).scorecard;
  }
  summarise(scorecard);
  if (report) console.log(`report: ${writeReport(scorecard)}/index.html`);
  if (arg('baseline') === 'write') {
    const p = writeBaseline(makeBaseline(scorecard, loadBaseline(profile)));
    console.log(`baseline written: ${p}`);
  }
  if (has('check')) {
    const bad = scorecard.verdict === 'fail' || (scorecard.regressions?.length ?? 0) > 0;
    if (!loadBaseline(profile)) console.log(`no baseline at ${baselinePath(profile)}: only the gates were checked`);
    return bad ? 1 : 0;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
