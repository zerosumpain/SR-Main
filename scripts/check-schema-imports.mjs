#!/usr/bin/env node
// Guard: src/lib/db/schema.ts must have no $lib imports.
//
// ci-release.sh rsyncs schema.ts to the VPS on its own (plus drizzle.config.ts)
// and runs `drizzle-kit push` against it there. Nothing sets up SvelteKit's
// $lib alias in that context, so any $lib import resolves to nothing and the
// push dies with MODULE_NOT_FOUND.
//
// The reason this needs a gate rather than care: the release job does NOT fail
// when the push fails. It logs the error, carries on, and reports success — so
// production silently runs one schema behind the code that expects it. That is
// exactly what happened on 2026-08-19, when schema.ts briefly re-exported the
// blog authorship vocabulary from $lib/blog/authorship and the `authorship`
// column never reached prod despite a green deploy.
//
// Relative imports are fine — but only if the release script also syncs them,
// which today it does not, so those are flagged too.

import { readFileSync } from 'node:fs';

const FILE = 'src/lib/db/schema.ts';
const src = readFileSync(FILE, 'utf8');

// Matches `import ... from 'x'` and `export ... from 'x'`, static form only.
const SPEC = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;

const offenders = [];
for (const m of src.matchAll(SPEC)) {
  const spec = m[1];
  if (spec.startsWith('$') || spec.startsWith('.')) {
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push({ spec, line });
  }
}

if (offenders.length > 0) {
  console.error(`check-schema-imports: FAIL — ${FILE} must be self-contained.\n`);
  for (const o of offenders) {
    console.error(`  ${FILE}:${o.line}  imports '${o.spec}'`);
  }
  console.error(
    `\nci-release.sh syncs this file alone to the VPS and runs drizzle-kit push\n` +
      `against it. A local import resolves to nothing there, the push fails with\n` +
      `MODULE_NOT_FOUND, and the release still reports success — leaving production\n` +
      `a schema behind. Inline what you need, or keep it in a file that imports\n` +
      `FROM schema.ts rather than the other way round.`,
  );
  process.exit(1);
}

console.log('check-schema-imports: OK — schema.ts has no local imports.');
