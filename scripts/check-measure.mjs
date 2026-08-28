#!/usr/bin/env node
// The width rule, asserted — no `ch` cap anywhere in the field study system.
//
// The gap this closes: a field study is a page of long-form argument, and every
// long-form convention says to cap the measure at 60–75 characters. So the CSS
// did (`--fs-measure: 72ch`), the templates did (20ch, 22ch, 44ch, 54ch, 58ch,
// 60ch, 62ch, 68ch), and — the part that made it recur — the SPEC did:
// CHECKLIST.md asked for "a single column at 68–74ch" and TEMPLATES.md wrote a
// ch figure against seven separate slots. Every author, human or model, was
// being told to do it.
//
// What that produced on a 1078px column was 286px of dead space beside every
// paragraph, on every beat, in both studies. It does not read as a considered
// measure; it reads as a layout that failed to fill.
//
// The rule is therefore: TEXT FILLS ITS COLUMN. To make a line shorter, narrow
// the COLUMN it sits in — a grid cell, --fs-margin-col, .fs-route — never the
// text inside it. That keeps the decision in the layout, where it is visible
// and shared, instead of in 30-odd private per-element caps.
//
// This applies to DISPLAY type too. A headline stopping a third of the way
// across is the same fault as a paragraph doing it, and "it's deliberate there"
// is exactly the argument that grew the other 30.
//
// SCOPE is the field study system only — the shared primitives, the two study
// routes, and the `.fs-*` rules in app.css. The rest of the site carries ~310
// more ch caps on surfaces (jkai, admin, research) that are dense UI rather
// than long-form argument; widening those is a separate decision and is NOT
// asserted here.
//
// Run:  node scripts/check-measure.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..');

const ROOTS = [
  'src/lib/fieldstudy',
  'src/routes/projects/data-spine',
  'src/routes/projects/spine-in-practice',
];

/** `max-width: 72ch`, `max-inline-size: 60ch`, `width: 44ch` — any of them cap text. */
const CAP = /(max-width|max-inline-size|width)\s*:\s*[0-9.]+ch\b/g;

/**
 * Blank out comments, keeping newlines so line numbers still line up.
 *
 * Not cosmetic: the rule this file enforces is explained in prose that quotes
 * the very patterns it bans, so a scanner that reads comments fails on its own
 * documentation. Covers CSS block comments and JS/Svelte line comments.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Only the field-study rules in the shared stylesheet: everything `.fs-` prefixed. */
function appCssFindings() {
  const lines = stripComments(readFileSync(join(REPO, 'src/app.css'), 'utf8')).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (/\.fs-/.test(line)) {
      for (const m of line.matchAll(CAP)) out.push({ file: 'src/app.css', line: i + 1, text: m[0] });
    }
    // The token itself, wherever it is declared — a named narrow measure is an
    // invitation even when nothing currently uses it.
    if (/--fs-measure\s*:/.test(line)) {
      out.push({ file: 'src/app.css', line: i + 1, text: '--fs-measure (the token itself)' });
    }
  });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(svelte|css|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

const findings = [...appCssFindings()];
for (const root of ROOTS) {
  const abs = join(REPO, root);
  let files = [];
  try {
    files = walk(abs);
  } catch {
    continue; // a study route that does not exist yet is not a failure
  }
  for (const f of files) {
    stripComments(readFileSync(f, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(CAP)) {
          findings.push({ file: relative(REPO, f), line: i + 1, text: m[0] });
        }
      });
  }
}

if (findings.length === 0) {
  console.log('check-measure: OK — text fills its column across the field study system.');
  process.exit(0);
}

console.error(`check-measure: ${findings.length} character-width cap(s) in the field study system.\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
console.error(`
Text fills its column. A cap in \`ch\` stops a line part-way across and leaves a
void beside it — which is what this rule exists to prevent, and what the system
used to ask for in writing.

To make a line shorter, narrow the COLUMN, not the text:
  - put it in a grid cell that is narrower
  - change --fs-margin-col (the margin column) or .fs-route (the page)
That keeps the decision visible in the layout instead of hidden per element.

Display type is not an exception.`);
process.exit(1);
