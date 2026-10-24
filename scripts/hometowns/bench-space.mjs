#!/usr/bin/env node
// Runs WP2a's month-step benchmark (space-bench.ts) the way production runs
// the engine: bundled into one module, then executed by plain Node. Prints
// JSON: [{mode, months, median, p95, max}, …] in milliseconds.
//
//   node scripts/hometowns/bench-space.mjs            # steady and cold, 240 months each
//   node scripts/hometowns/bench-space.mjs 600        # more months
//
// The space package's acceptance test (space.bench.test.ts) calls
// bundledBench() and fails if a p95 exceeds the budget × the CI margin.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Bundles and runs the benchmark in a child Node; null when esbuild is not installed. */
export async function bundledBench(months = 240) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    return null;
  }
  const entry = `
    import { benchSpace } from ${JSON.stringify(join(HERE, 'space-bench.ts'))};
    const clock = { now: () => performance.now() };
    console.log(JSON.stringify([benchSpace(clock, 'steady', ${months}, ${Math.min(60, months)}), benchSpace(clock, 'cold', ${months}, 20)]));
  `;
  const dir = mkdtempSync(join(tmpdir(), 'hometowns-bench-'));
  try {
    const out = join(dir, 'bench.mjs');
    await esbuild.build({ stdin: { contents: entry, resolveDir: HERE, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
    return JSON.parse(execFileSync(process.execPath, [out], { encoding: 'utf8', timeout: 120_000 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const months = Number(process.argv[2] ?? 240);
  const r = await bundledBench(months);
  if (!r) {
    console.error('esbuild is not installed; run the benchmark under vitest instead (space.bench.test.ts).');
    process.exit(1);
  }
  console.log(JSON.stringify(r, null, 2));
}
