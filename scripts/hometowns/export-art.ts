// Writes the procedural art (games/hometowns-view/src/art/portraits.ts) as
// SVG files, for the app's asset catalogue or a quick look in a browser:
//
//   npx tsx scripts/hometowns/export-art.ts <out-dir>
//
// The files are generated, so they are not committed here; the app copies
// the set it needs. An index.html contact sheet is written beside them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { allArt } from '../../games/hometowns-view/src/art/portraits';

const out = process.argv[2];
if (!out) {
  console.error('usage: npx tsx scripts/hometowns/export-art.ts <out-dir>');
  process.exit(2);
}
const dir = resolve(out);
mkdirSync(dir, { recursive: true });
const art = allArt();
for (const [name, svg] of Object.entries(art)) writeFileSync(join(dir, name), svg + '\n');
const cells = Object.keys(art)
  .map((name) => `<figure><img src="${name}" width="128" height="128" alt=""><figcaption>${name}</figcaption></figure>`)
  .join('\n');
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Hometowns art</title>` +
    `<style>body{font:12px system-ui;display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;text-align:center}</style>\n${cells}\n`,
);
console.log(`wrote ${Object.keys(art).length} SVGs and index.html to ${dir}`);
