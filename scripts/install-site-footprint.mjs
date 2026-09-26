#!/usr/bin/env node
/** Install the private repository snapshot without placing it in a public build. */
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const raw = process.env.SITE_FOOTPRINT_JSON;
if (!raw) throw new Error('SITE_FOOTPRINT_JSON is required for a production release');
const snapshot = JSON.parse(raw);
if (!Array.isArray(snapshot.repositories) || snapshot.repositories.length !== 7 ||
    typeof snapshot.measuredAt !== 'string') {
  throw new Error('SITE_FOOTPRINT_JSON must contain seven revision-pinned repositories');
}

const target = process.env.SITE_FOOTPRINT_PATH ||
  join(process.env.VPS_DIR || '/opt/strange-rambling-svelte', 'data/site-footprint.json');
mkdirSync(dirname(target), { recursive: true });
const pending = `${target}.tmp`;
writeFileSync(pending, raw.endsWith('\n') ? raw : `${raw}\n`, { mode: 0o644 });
renameSync(pending, target);
chmodSync(target, 0o644);
console.log('Installed private site footprint for seven service repositories.');
