#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SOURCE_FOOTPRINT_ROOT
  ? path.resolve(process.env.SOURCE_FOOTPRINT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_EXTENSIONS = new Set([
  '.css', '.glsl', '.html', '.js', '.mjs', '.py', '.sh', '.sql', '.svelte', '.ts',
]);
const GENERATED_PATH = /^(?:build|\.svelte-kit)\/|^packages\/[^/]+\/dist\//;
const TEST_PATH = /(?:^tests\/|\.(?:integration\.)?(?:test|spec)\.[^.]+$|\/__tests__\/)/;
const LIMITS = {
  // A budget that fires every few hours stops being a brake and becomes a coin
  // toss on whether your PR is the one that trips it. Each of these is now set
  // to a MEASURED thirty days of headroom rather than to a small margin over
  // whatever master happened to be on the day it was written.
  //
  // Recalibrated 2026-09-06. Every one of the five was between 98.6% and 100.0%
  // full on the same afternoon, because the previous values were each set at
  // roughly 1% above the then-current count — in a repo whose production count
  // grew 538,483 → 607,911 in the seven days to 2026-09-06. Measured daily rates
  // over that week, which is what these numbers are built from:
  //
  //   production  +9,918/day     projects  -1,383/day     workflows  +43/day
  //   tests       +2,946/day     panels      -184/day
  //
  // Growing areas get thirty days at that rate; the two that are SHRINKING get a
  // flat ~10% margin instead, since extrapolating a negative rate would ratchet
  // their budget down and punish the next rebound.
  //
  // The history this replaces: 606,000 → 608,000 on 2026-09-05 (PR #722, the
  // sources journey, +1,016 net), set the day before at 411 lines above master
  // and crossed by the very next feature. Then crossed again on 2026-09-06 by
  // PR #734, which only reformatted one page — the file it replaced was 90 lines
  // because it was minified, and 320 lines once written the way the rest of the
  // codebase is written. That is the failure mode worth naming: this gate counts
  // LINES, so it charges for readability and refunds minification. It cannot
  // tell a page that grew from one that was merely un-minified, and a per-PR
  // delta check would suit this repo better than an absolute ceiling.
  //
  // Owner's call to ratchet these back down.
  production: 910_000,
  projects: 100_000,
  workflows: 60_000,
  panels: 26_000,
  tests: 210_000,
};

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
}

function linesIn(relativePath) {
  const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
  if (!source) return 0;
  const lines = source.split(/\r?\n/).length;
  return source.endsWith('\n') ? lines - 1 : lines;
}

function isCode(relativePath) {
  return CODE_EXTENSIONS.has(path.extname(relativePath)) && !GENERATED_PATH.test(relativePath);
}

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const generated = tracked.filter((file) => GENERATED_PATH.test(file));
if (generated.length > 0) {
  console.error('source footprint: generated output is tracked:');
  for (const file of generated) console.error(`  ${file}`);
  process.exitCode = 1;
}

const candidates = git(['ls-files', '-co', '--exclude-standard', '-z'])
  .split('\0')
  .filter((file, index, files) => file && files.indexOf(file) === index)
  .filter((file) => existsSync(path.join(ROOT, file)) && isCode(file));
const counts = { production: 0, projects: 0, workflows: 0, panels: 0, tests: 0 };
const maintainedRoots = /^(?:src|packages|services|field-study-system|vite-plugins)\//;

for (const file of candidates) {
  const lines = linesIn(file);
  if (TEST_PATH.test(file)) {
    counts.tests += lines;
    continue;
  }
  if (!maintainedRoots.test(file)) continue;
  counts.production += lines;
  if (file.startsWith('src/routes/projects/')) counts.projects += lines;
  if (file.startsWith('src/lib/workflows/')) counts.workflows += lines;
  if (file.startsWith('src/lib/canvas/nodes/panels/')) counts.panels += lines;
  if (lines > 10_000) {
    console.error(`source footprint: ${file} has ${lines} lines (limit 10,000)`);
    process.exitCode = 1;
  }
}

for (const [area, lines] of Object.entries(counts)) {
  const limit = LIMITS[area];
  console.log(`source footprint: ${area} ${lines.toLocaleString()} / ${limit.toLocaleString()} lines`);
  if (lines > limit) {
    console.error(`source footprint: ${area} exceeds its budget by ${(lines - limit).toLocaleString()} lines`);
    process.exitCode = 1;
  }
}

const baseCandidates = [process.env.FOOTPRINT_BASE_REF, 'github/master', 'origin/master']
  .filter(Boolean);
const base = baseCandidates.find((candidate) => {
  try {
    git(['rev-parse', '--verify', candidate]);
    return true;
  } catch {
    return false;
  }
});
if (base) {
  const added = new Set(
    git(['diff', '--diff-filter=A', '--name-only', `${base}...HEAD`])
      .split('\n')
      .filter(Boolean),
  );
  for (const file of candidates) {
    if (!tracked.includes(file)) added.add(file);
  }
  for (const file of added) {
    if (!isCode(file) || !existsSync(path.join(ROOT, file))) continue;
    const lines = linesIn(file);
    if (lines > 1_000) {
      console.error(`source footprint: new source file ${file} has ${lines} lines (limit 1,000)`);
      process.exitCode = 1;
    }
  }
}

if (!process.exitCode) console.log('source footprint: ok');
