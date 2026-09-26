#!/usr/bin/env node
/** Refresh the revision-pinned site repository inventory from local git objects. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureRepository } from '../vite-plugins/source-footprint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const checkoutsPath = option('--checkouts');
const manifestPath = option('--manifest');
const outputPath = option('--output');
if (!checkoutsPath || !manifestPath || !outputPath) {
  throw new Error('Usage: node scripts/refresh-site-footprint.mjs --manifest <private-repositories.json> --checkouts <id-to-path-and-ref.json> --output <private-footprint.json>');
}
const target = resolve(outputPath);
const withinRepo = relative(root, target);
if (!withinRepo.startsWith('..') && !isAbsolute(withinRepo)) {
  throw new Error('Private site footprint output must be outside the public repository');
}
const checkouts = JSON.parse(readFileSync(resolve(checkoutsPath), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const measuredAt = new Date().toISOString();
const repositories = [];

for (const entry of manifest) {
  const input = checkouts[entry.id];
  if (!input?.path) throw new Error(`Missing checkout for ${entry.id}`);
  const checkout = resolve(input.path);
  const revision = execFileSync('git', ['-C', checkout, 'rev-parse', input.ref || 'HEAD'], { encoding: 'utf8' }).trim();
  const temp = mkdtempSync(join(tmpdir(), 'sr-site-source-'));
  try {
    const archive = join(temp, 'source.tar');
    const extracted = join(temp, 'source');
    execFileSync('mkdir', ['-p', extracted]);
    execFileSync('git', ['-C', checkout, 'archive', '--format=tar', '-o', archive, revision]);
    execFileSync('tar', ['-xf', archive, '-C', extracted]);
    repositories.push({ ...entry, revision, measuredAt, source: 'revision snapshot', ...measureRepository(extracted) });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const pending = `${target}.tmp`;
writeFileSync(pending, JSON.stringify({ measuredAt, repositories }, null, 2) + '\n', { mode: 0o600 });
renameSync(pending, target);
chmodSync(target, 0o600);
console.log(`Measured ${repositories.length + 1} site repositories (including SR-Main at build time).`);
