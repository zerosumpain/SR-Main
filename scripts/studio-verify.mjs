#!/usr/bin/env node
/**
 * The check a studio agent runs on its own work, before it says it is done.
 *
 * Usage, from anywhere:
 *   node <repo>/scripts/studio-verify.mjs --base http://127.0.0.1:4310 --chapter 3
 *   node <repo>/scripts/studio-verify.mjs --base http://127.0.0.1:4310        # all chapters
 *
 * WHY THIS EXISTS
 *
 * The agent had no way to look at what it built. Across eight builds it made
 * 59 attempts to open a browser and 39 died on MODULE_NOT_FOUND, because
 * `import('playwright')` resolves from the importing script's own directory
 * and the workspace has no node_modules. The system prompt told it Playwright
 * was already installed. It was not — not there. It is here, next to this
 * file, which is why this script lives in the repo and takes a URL instead of
 * being copied into the workspace.
 *
 * WHY IT SHELLS OUT TO THE GATE
 *
 * It runs scripts/studio-gate.mjs — the same checks, the same code, the same
 * base-href surface the orchestrator scores the build on. A second
 * implementation would drift, and the agent would then be optimising against
 * a check that no longer matches the one that decides its fate. This repo
 * already has a memory of exactly that: one detector living in three copies.
 *
 * Output is written for a model to act on: what failed, and what to change.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'studio-gate.mjs');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg('base', process.env.STUDIO_BASE_URL);
const only = arg('chapter');
const spinePath = arg('spine', process.env.STUDIO_SPINE);

if (!baseUrl) {
  console.error(
    'studio-verify: no base url.\n' +
      '  node scripts/studio-verify.mjs --base http://127.0.0.1:<port> [--chapter N]\n' +
      '  (or set STUDIO_BASE_URL)',
  );
  process.exit(2);
}

/**
 * The chapter spine — titles and the lever/outcome ids each chapter owes.
 *
 * Written by the orchestrator next to the workspace so the agent and the gate
 * cannot disagree about what a chapter is called or which control it needs.
 * Without it we can still check structure, just not the ids.
 */
let spine = { chapters: [], sourceUrls: [], kitFiles: [] };
if (spinePath) {
  try {
    spine = JSON.parse(await readFile(resolve(spinePath), 'utf-8'));
  } catch (err) {
    console.error(`studio-verify: could not read the spine at ${spinePath} (${err.message}).`);
    console.error('Checking structure only — lever and citation checks need it.');
  }
}

let chapters = (spine.chapters ?? []).map((c) => ({ ...c, path: c.path ?? `/chapter-${c.n}/` }));
if (only) {
  const n = Number.parseInt(only, 10);
  const picked = chapters.filter((c) => c.n === n);
  if (picked.length === 0) {
    // Still worth checking: a chapter absent from the spine is usually the
    // agent inventing one, and reporting "not in the plan" beats silence.
    console.error(`studio-verify: chapter ${n} is not in the spine — checking it as an extra chapter.`);
    chapters = [{ n, title: `Chapter ${n}`, path: `/chapter-${n}/`, leverId: '', outcomeId: '' }];
  } else {
    chapters = picked;
  }
}
if (chapters.length === 0) {
  console.error('studio-verify: no chapters to check (empty spine and no --chapter).');
  process.exit(2);
}

const spec = {
  chapters,
  // Everything named here is being checked NOW, so everything is due. The
  // orchestrator's run is the one that applies the real deadline.
  chaptersDue: Math.max(...chapters.map((c) => c.n)),
  sourceUrls: spine.sourceUrls ?? [],
  // Deliberately omitted: kit-missing and no-scene are whole-project rules.
  // Reporting them while the agent works on one chapter is noise it cannot
  // act on, and the orchestrator's run still catches them.
  kitFiles: only ? [] : (spine.kitFiles ?? []),
};

const raw = await new Promise((res) => {
  const child = spawn(process.execPath, [GATE, baseUrl], { cwd: HERE });
  let acc = '';
  let err = '';
  child.stdout.on('data', (d) => (acc += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('close', () => res(acc || `{"ran":false,"reason":${JSON.stringify(err.slice(0, 300))}}`));
  child.stdin.end(Buffer.from(JSON.stringify(spec), 'utf-8').toString('base64'));
});

let result;
try {
  result = JSON.parse(raw.slice(raw.indexOf('{')));
} catch {
  console.error(`studio-verify: the gate produced no readable output.\n${raw.slice(0, 400)}`);
  process.exit(2);
}

const scope = only ? `chapter ${only}` : `${chapters.length} chapter(s)`;

if (!result.ran) {
  console.error(`studio-verify: could not check ${scope} — ${result.reason}`);
  console.error('This is a harness problem, not a verdict on your work. Is the server up on that port?');
  process.exit(2);
}

if (result.passed) {
  console.log(`PASS — ${scope} reachable, visual, interactive and cited.`);
  process.exit(0);
}

console.log(`FAIL — ${result.findings.length} finding(s) on ${scope}:\n`);
for (const f of result.findings) {
  console.log(`  [${f.rule}] chapter ${f.chapter}: ${f.message}`);
  console.log(`      fix: ${f.remedy}\n`);
}
console.log('Fix these and run this command again. The orchestrator runs the identical check.');
process.exit(1);
