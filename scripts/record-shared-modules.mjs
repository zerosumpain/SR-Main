#!/usr/bin/env node
/** Re-record shared-with-extracted.json after a deliberate change. Change the peer repo too. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'shared-with-extracted.json';
const manifest = JSON.parse(readFileSync(path, 'utf8'));
for (const [file, entry] of Object.entries(manifest.files)) {
  entry.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
}
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Recorded ${Object.keys(manifest.files).length} shared modules. ` +
    `Make the same change in the peer repositories, or they have now diverged.`,
);
