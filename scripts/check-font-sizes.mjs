#!/usr/bin/env node
// Minimum-text-size lockfile for the jkai surfaces.
//
// The gap this closes: the jkai pages accumulated ~580 hand-written px font
// sizes, 250-odd of them under 11px, because each one looked fine on its own in
// a dense panel. There is no linter for "this text is too small" — svelte-check
// and Prettier are both perfectly happy with `font-size: 8px`. So the floor has
// to be asserted, or it erodes again one component at a time.
//
// The floor is 12px / 0.75rem, matching --fs-label-xs in src/app.css. WCAG 2.2
// sets no explicit minimum size, but text this small fails in practice on two
// counts: SC 1.4.4 (a px size ignores the reader's browser font-size preference
// outright) and SC 1.4.10/1.4.12 (sub-16px form fields make mobile Safari
// force-zoom the viewport, stranding the rest of the form off-screen).
//
// Use the tokens, not literals: --fs-label-xs (12) --fs-label (13) --fs-nav (14)
// --fs-body-sm (15) --fs-body (16) --fs-body-lg (18). Typed fields get --fs-body.
//
// Run:  node scripts/check-font-sizes.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..');

const FLOOR_PX = 12;
const FLOOR_REM = 0.75;

// Guarded scope: everything a /jkai page actually renders. That is NOT just
// src/lib/components/jkai — the jkai routes pull in 72 more components from
// src/lib/canvas, src/lib/builds and src/lib/components/intel, and the first
// pass at this missed all of them. Everything else on the site still carries
// legacy literals; widening this list is how that debt gets paid down.
const SCOPE = [
  ['src/routes/jkai', true],
  ['src/lib/components/jkai', true],
  ['src/lib/components/intel', true],
  ['src/lib/canvas', true],
  ['src/lib/builds', true],
  ['src/app.css', false],
  ['src/lib/styles/nm-tokens.css', false],
  ['src/lib/components/drive/FileViewerModal.svelte', false],
  ['src/lib/components/SiteNav.svelte', false],
  ['src/lib/components/PageHeader.svelte', false],
];

// If the extraction below silently breaks (a reformat, a refactor), the
// inventory shrinks and this check goes green for the wrong reason. These are
// sizes we know are present and legal; not finding them means fix the script.
const MIN_DECLARATIONS = 400;
const CANARY_TOKENS = ['--fs-label-xs', '--fs-body'];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(svelte|css)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = SCOPE.flatMap(([p, isDir]) =>
  isDir ? walk(join(REPO, p)) : [join(REPO, p)]
);

let counted = 0;
const violations = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(REPO, file).split('\\').join('/');

  // Count every declaration, token or literal — the canary below needs the
  // total. A healthy file is almost all `font-size: var(--fs-*)`, so counting
  // only numeric matches would make the canary shrink as the sweep succeeds.
  counted += [...src.matchAll(/font-size'?\s*[:,]/g)].length;

  // font-size: 9px | font-size:9px | .attr('font-size', '9px')
  for (const m of src.matchAll(/font-size'?\s*[:,]\s*'?(\d+(?:\.\d+)?)(px|rem)/g)) {
    const n = parseFloat(m[1]);
    const px = m[2] === 'px' ? n : n * 16;
    const floor = m[2] === 'px' ? FLOOR_PX : FLOOR_REM;
    if (n < floor) {
      const line = src.slice(0, m.index).split('\n').length;
      const text = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
      violations.push(`  ${rel}:${line}  ${m[1]}${m[2]} (${px}px)  ${text.trim().slice(0, 88)}`);
    }
  }

  // Unitless SVG presentation attribute: .attr('font-size', 11). Neither the
  // px/rem regex above nor a var() token reaches these — d3 writes them
  // straight onto the element, so they need a literal number and their own
  // check. This is how an 11px graph label survived the first sweep.
  for (const m of src.matchAll(/font-size'?\s*,\s*(\d+(?:\.\d+)?)\s*[),]/g)) {
    if (parseFloat(m[1]) < FLOOR_PX) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(
        `  ${rel}:${line}  unitless SVG font-size ${m[1]} — below the ${FLOOR_PX}px floor`
      );
    }
  }

  // A bare sub-1em size inherits whatever the parent happens to be, so it can
  // land under the floor without any small number appearing in the source.
  // Wrap it: max(0.85em, var(--fs-label-xs)).
  for (const m of src.matchAll(/font-size:\s*(0?\.\d+)em/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    violations.push(
      `  ${rel}:${line}  ${m[1]}em has no floor — use max(${m[1]}em, var(--fs-label-xs))`
    );
  }

  // Tailwind text-xs (12px) is at the floor for static text but below it for a
  // field you type into — those must be text-base.
  for (const m of src.matchAll(/<(?:input|textarea)\b[^>]*>/g)) {
    if (/class="[^"]*\btext-(xs|sm)\b/.test(m[0])) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push(
        `  ${rel}:${line}  Tailwind text-${/text-(xs|sm)/.exec(m[0])[1]} on a typed field — use text-base (16px)`
      );
    }
  }
}

const appCss = readFileSync(join(REPO, 'src', 'app.css'), 'utf8');
for (const tok of CANARY_TOKENS) {
  if (!appCss.includes(`${tok}:`)) {
    console.error(
      `check-font-sizes: token ${tok} is gone from src/app.css. The scale was ` +
        'renamed or removed — update this script rather than deleting the check.'
    );
    process.exit(2);
  }
}

if (counted < MIN_DECLARATIONS) {
  console.error(
    `check-font-sizes: only found ${counted} font-size declarations, expected ` +
      `at least ${MIN_DECLARATIONS}. The regex has stopped matching — fix the ` +
      'extraction, do not lower the threshold.'
  );
  process.exit(2);
}

if (!violations.length) {
  console.log(
    `check-font-sizes: OK — ${counted} declarations across ${files.length} files, ` +
      `none below ${FLOOR_PX}px.`
  );
  process.exit(0);
}

console.error(`check-font-sizes: ${violations.length} declaration(s) below the ${FLOOR_PX}px floor.\n`);
for (const v of violations) console.error(v);
console.error(
  '\nUse a token instead of a literal:\n' +
    '  --fs-label-xs 12px   --fs-label 13px   --fs-nav 14px\n' +
    '  --fs-body-sm  15px   --fs-body  16px   --fs-body-lg 18px\n' +
    'Anything a reader types into gets --fs-body — under 16px, mobile Safari\n' +
    'force-zooms the viewport on focus. If a design genuinely needs smaller\n' +
    'text, it needs a different design.'
);
process.exit(1);
