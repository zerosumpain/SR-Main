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
  // Small operating margins allow ordinary edits, but a new feature that
  // crosses one of these lines must pay for itself by retiring nearby code.
  production: 606_000,
  projects: 92_000,
  workflows: 57_000,
  panels: 23_500,
  tests: 120_000,
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
