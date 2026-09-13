#!/usr/bin/env node
// Post-build guards for the three routes reduced in the 2026-09 efficiency pass.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const CLIENT = '.svelte-kit/output/client';
const GENERATED_NODES = '.svelte-kit/generated/client-optimized/nodes';
const MANIFEST_PATH = `${CLIENT}/.vite/manifest.json`;

if (!existsSync(MANIFEST_PATH)) {
  console.error('client budgets: build output is missing; run vite build first');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const budgets = [
  { route: 'home', source: 'src/routes/+page.svelte', gzipKiB: 100 },
  { route: 'blog editor', source: 'src/routes/admin/content/blog/[id]/+page.svelte', gzipKiB: 150 },
  // The client-side node-definition registry is still deliberately shared by
  // the palette and inspector; 550 KiB holds the measured 514.5 KiB result and
  // prevents a return to the 718 KiB pre-split route.
  { route: 'canvas', source: 'src/routes/jkai/canvas/[slug]/+page.svelte', gzipKiB: 550 },
];

function generatedNodeFor(source) {
  for (const filename of readdirSync(GENERATED_NODES)) {
    if (!filename.endsWith('.js')) continue;
    const path = `${GENERATED_NODES}/${filename}`;
    if (readFileSync(path, 'utf8').includes(source)) {
      return `.svelte-kit/generated/client-optimized/nodes/${filename}`;
    }
  }
  throw new Error(`generated route node not found for ${source}`);
}

function staticFootprint(entryKey) {
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`manifest entry not found: ${key}`);
    visited.add(key);
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    // Dynamic imports are intentionally excluded: this gate measures what a
    // navigation must load, not optional editors/renderers requested later.
    for (const dependency of entry.imports ?? []) visit(dependency);
  }
  visit(entryKey);
  return [...files].reduce((total, file) => {
    return total + gzipSync(readFileSync(`${CLIENT}/${file}`)).length;
  }, 0);
}

let failed = false;
for (const budget of budgets) {
  const bytes = staticFootprint(generatedNodeFor(budget.source));
  const kib = bytes / 1024;
  console.log(`client budget: ${budget.route} ${kib.toFixed(1)} / ${budget.gzipKiB} KiB gzip`);
  if (kib > budget.gzipKiB) {
    console.error(`client budget exceeded: ${budget.route}`);
    failed = true;
  }
}

if (failed) process.exit(1);
