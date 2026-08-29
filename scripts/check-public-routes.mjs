#!/usr/bin/env node
// Public-surface lockfile.
//
// The gap this closes: `isPublicPath` matches by PREFIX
// (`pathname === p || pathname.startsWith(p + '/')`), and hooks.server.ts adds
// ~10 more `startsWith` bypasses. So whole trees — /api/agent, /api/scraper,
// /projects, /decks, /jkai/shared, /dav, /api/mcp — are already past the
// Auth.js gate. A NEW route file under one of those prefixes is anonymously
// reachable THE MOMENT IT IS CREATED, with no allowlist edit anywhere. Nothing
// in .github/protected-paths.txt can catch that, because no protected file
// changes.
//
// So instead of guarding a file, this pins the SURFACE: it enumerates every
// route that anonymous traffic can reach today and diffs that against
// .github/public-routes.txt. Adding one becomes a visible, reviewable line in
// that snapshot rather than an invisible side effect of creating a file.
//
// Run:  node scripts/check-public-routes.mjs          (check — exits 1 on drift)
//       node scripts/check-public-routes.mjs --write  (accept the current surface)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..');
const ROUTES = join(REPO, 'src', 'routes');
const SNAPSHOT = join(REPO, '.github', 'public-routes.txt');

// Prefixes we must always find. If the extraction below silently stops working
// (a refactor, a reformat), the inventory would shrink and the diff would go
// green for the wrong reason. Failing loudly here is the point.
const CANARIES = ['/api/agent', '/projects', '/api/scraper/run', '/decks'];

function read(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/**
 * String literals in the PUBLIC_PATHS array in src/lib/auth.ts.
 *
 * Comments are stripped BEFORE the literals are extracted. They used not to be,
 * and the entries in that array are heavily commented — so any quoted word in
 * the prose became a public prefix. The comment explaining that /jkai is NOT
 * public reads `isPublicPath('/jkai') remains false`, which handed the scraper
 * `/jkai` as a prefix and made the gate treat the entire owner-only jkai area
 * as known-anonymous. It then stopped reporting anything added under it: ~40
 * routes were listed in the snapshot as reachable without a session when they
 * all 302 to /login. A gate that is green for the wrong reason is the one
 * failure mode this script exists to prevent, so strip prose first.
 */
function publicPathsFromAuth() {
  const src = read(join(REPO, 'src', 'lib', 'auth.ts'));
  const block = src.match(/const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) return [];
  const code = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * String literals in PUBLIC_API_PATHS (src/lib/server/public-api-paths.ts).
 *
 * This array is the OTHER way a route becomes anonymously reachable, and until
 * 2026-08-29 this script had never read it. hooks.server.ts consults it for
 * every /api/* request, so one line here opens one route to the internet
 * without touching auth.ts, hooks.server.ts or any file in
 * .github/protected-paths.txt — exactly the invisible addition this script
 * exists to make visible.
 *
 * That blind spot is not hypothetical: `/api/family-presence/stats` sat in this
 * array serving five people's clustered GPS history and current positions by
 * first name, three of them children, and nothing flagged it. It happened to be
 * the only entry not ALSO covered by a PUBLIC_PATHS prefix, so removing it
 * emptied the blind spot without sealing it — today's two survivors,
 * /api/biome/state and /api/landing/ecg-telemetry, are already in the snapshot
 * via the /api/biome and /api/landing prefixes, which is why closing this gap
 * changes the route count by zero. The point is the NEXT entry.
 *
 * These are EXACT paths, never prefixes: isPublicApiPath compares with ===.
 * Treating them as prefixes would over-report the surface and, worse, would
 * hand every route under /api/biome/state/* to the snapshot as anonymous when
 * the hook would 401 them.
 *
 * Same technique as publicPathsFromAuth: strip prose first, then take the
 * literals. The entries here are heavily commented too.
 */
function publicApiPathsFrom() {
  const src = read(join(REPO, 'src', 'lib', 'server', 'public-api-paths.ts'));
  return arrayLiteralsFrom(src, 'PUBLIC_API_PATHS');
}

// Hook-level bypass catalogue.
//
// These four arrays USED to live here. They now live in
// src/lib/server/gate-bypasses.ts and are extracted from it, because
// /admin/estate became a second reader and a second copy is exactly how this
// list starts lying — see the note at the top of that file. Same technique as
// publicPathsFromAuth above: strip prose first, then take the literals.
function arrayLiteralsFrom(src, name) {
  // Terminator is `];` anywhere, NOT `\n];`. HOOK_PAGE_PREFIX_BYPASSES is a
  // one-liner, so anchoring to a newline ran the lazy match past its own end
  // and into the NEXT array — swallowing HOOK_NON_BYPASSES and handing this
  // script `/api` as a public prefix, i.e. declaring all 300+ API routes
  // anonymous. Caught by the disjointness assertion below, which exists
  // because of it.
  // `] as const;` as well as `];` — PUBLIC_API_PATHS is declared `as const` so
  // that isPublicApiPath's === comparison is typed, and a terminator that only
  // knew about `];` read that array as empty. The canary assertions below are
  // what turned that into a loud failure rather than a silently smaller surface.
  const block = src.match(
    new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const\\s*)?;`),
  );
  if (!block) return [];
  const code = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const GATE_BYPASSES_SRC = read(join(REPO, 'src', 'lib', 'server', 'gate-bypasses.ts'));
const HOOK_BYPASSES = arrayLiteralsFrom(GATE_BYPASSES_SRC, 'HOOK_BYPASSES');
const HOOK_EXACT_BYPASSES = arrayLiteralsFrom(GATE_BYPASSES_SRC, 'HOOK_EXACT_BYPASSES');
const HOOK_PAGE_PREFIX_BYPASSES = arrayLiteralsFrom(GATE_BYPASSES_SRC, 'HOOK_PAGE_PREFIX_BYPASSES');
const HOOK_NON_BYPASSES = arrayLiteralsFrom(GATE_BYPASSES_SRC, 'HOOK_NON_BYPASSES');

// The extraction above is a regex over another file, so it can silently return
// [] after a refactor — and an empty bypass list makes the surface look SMALLER,
// which is a green gate for the worst possible reason. Assert the shape.
{
  const expected = {
    HOOK_BYPASSES: { list: HOOK_BYPASSES, min: 25, canary: '/api/mcp' },
    HOOK_EXACT_BYPASSES: { list: HOOK_EXACT_BYPASSES, min: 1, canary: '/health' },
    HOOK_PAGE_PREFIX_BYPASSES: { list: HOOK_PAGE_PREFIX_BYPASSES, min: 1, canary: '/tools' },
    HOOK_NON_BYPASSES: { list: HOOK_NON_BYPASSES, min: 3, canary: '/api' },
  };
  for (const [name, { list, min, canary }] of Object.entries(expected)) {
    if (list.length < min || !list.includes(canary)) {
      console.error(
        `check-public-routes: could not read ${name} from src/lib/server/gate-bypasses.ts ` +
          `(got ${list.length} entries, canary ${canary} ${list.includes(canary) ? 'present' : 'MISSING'}).\n` +
          'Fix the extraction in this script rather than regenerating the snapshot, or the ' +
          'check silently covers nothing.',
      );
      process.exit(2);
    }
  }

  // Under-matching makes the surface look smaller; OVER-matching makes it look
  // bigger AND drags non-bypasses into the public prefix list. The four lists
  // describe disjoint categories, so an overlap can only mean the extraction
  // ate past an array boundary.
  const pairs = [
    ['HOOK_BYPASSES', HOOK_BYPASSES],
    ['HOOK_EXACT_BYPASSES', HOOK_EXACT_BYPASSES],
    ['HOOK_PAGE_PREFIX_BYPASSES', HOOK_PAGE_PREFIX_BYPASSES],
    ['HOOK_NON_BYPASSES', HOOK_NON_BYPASSES],
  ];
  for (const [aName, a] of pairs) {
    for (const [bName, b] of pairs) {
      if (aName >= bName) continue;
      const overlap = a.filter((x) => b.includes(x));
      if (overlap.length) {
        console.error(
          `check-public-routes: ${aName} and ${bName} both contain ${overlap.join(', ')}.\n` +
            'These categories are disjoint, so the extraction has run past an array\n' +
            'boundary in src/lib/server/gate-bypasses.ts. Fix the regex in this script.',
        );
        process.exit(2);
      }
    }
  }
}

/**
 * Fail if hooks.server.ts grows a path literal we haven't classified. A new
 * bypass there is exactly the change this script exists to notice, and silently
 * ignoring it would leave the new tree unmonitored.
 */
function assertNoUnclassifiedHookPaths() {
  const src = read(join(REPO, 'src', 'hooks.server.ts'));
  const seen = new Set();
  for (const m of src.matchAll(/pathname(?:\s*===\s*|\.startsWith\()\s*'([^']+)'/g)) {
    seen.add(m[1].replace(/\/$/, ''));
  }
  const known = new Set([
    ...HOOK_BYPASSES,
    ...HOOK_EXACT_BYPASSES,
    ...HOOK_PAGE_PREFIX_BYPASSES,
    ...HOOK_NON_BYPASSES,
  ]);
  const unknown = [...seen].filter((p) => !known.has(p));
  if (unknown.length) {
    console.error(
      `check-public-routes: unclassified path literal(s) in hooks.server.ts: ${unknown.join(', ')}\n` +
        'Decide whether each one BYPASSES the auth gate or enforces it, then add it to\n' +
        'HOOK_BYPASSES or HOOK_NON_BYPASSES in this script. Do not skip this — an\n' +
        'unclassified bypass means a whole route tree goes unmonitored.',
    );
    process.exit(2);
  }
}

/** src/routes/api/agent/foo/+server.ts → /api/agent/foo */
function routePath(file) {
  const rel = relative(ROUTES, file).split('\\').join('/');
  const dir = rel.replace(/\/\+(server\.ts|page\.svelte|page\.server\.ts)$/, '');
  const cleaned = dir
    .split('/')
    .filter((seg) => seg && !/^\(.*\)$/.test(seg)) // drop (route groups)
    .join('/');
  return '/' + cleaned;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/^\+(server\.ts|page\.svelte)$/.test(entry)) acc.push(full);
  }
  return acc;
}

assertNoUnclassifiedHookPaths();

const PUBLIC_API_PATHS = publicApiPathsFrom();

// Same failure mode as the four bypass arrays: a regex over another file can
// silently return [] after a refactor, and an empty list makes the surface look
// SMALLER — a green gate for the worst possible reason. /api/biome/state is the
// canary because it is the oldest entry and the least likely to move.
if (PUBLIC_API_PATHS.length < 2 || !PUBLIC_API_PATHS.includes('/api/biome/state')) {
  console.error(
    'check-public-routes: could not read PUBLIC_API_PATHS from ' +
      `src/lib/server/public-api-paths.ts (got ${PUBLIC_API_PATHS.length} entries, ` +
      `canary /api/biome/state ${PUBLIC_API_PATHS.includes('/api/biome/state') ? 'present' : 'MISSING'}).\n` +
      'Fix the extraction in this script rather than regenerating the snapshot, or a\n' +
      'route added to that array is world-readable with nothing to review.',
  );
  process.exit(2);
}

const prefixes = [...new Set([...publicPathsFromAuth(), ...HOOK_BYPASSES, ...HOOK_PAGE_PREFIX_BYPASSES])];
// PUBLIC_API_PATHS join HOOK_EXACT_BYPASSES rather than the prefix list: both
// are matched with === by the code that enforces them.
const exact = new Set([...HOOK_EXACT_BYPASSES, ...PUBLIC_API_PATHS]);

const missing = CANARIES.filter((c) => !prefixes.includes(c));
if (missing.length) {
  console.error(
    `check-public-routes: expected prefixes not found: ${missing.join(', ')}\n` +
      'The extraction from auth.ts / hooks.server.ts has broken — fix this script ' +
      'rather than regenerating the snapshot, or the check silently covers nothing.',
  );
  process.exit(2);
}

const isPublic = (p) => exact.has(p) || prefixes.some((pre) => p === pre || p.startsWith(pre + '/'));

const surface = walk(ROUTES)
  .map(routePath)
  .filter(isPublic)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();

const header = [
  '# Anonymously-reachable routes — GENERATED, do not hand-edit.',
  '#',
  '# Every route here can be reached WITHOUT a session, because it sits under a',
  '# prefix in PUBLIC_PATHS (src/lib/auth.ts) or a bypass in hooks.server.ts —',
  '# or, for the exact paths in HOOK_EXACT_BYPASSES and PUBLIC_API_PATHS',
  '# (src/lib/server/public-api-paths.ts), because that one path is public while',
  '# everything beneath it is not.',
  '# Being listed is not a bug — but each line should be a deliberate decision,',
  '# and several self-gate internally (requireProjectPublic, requireDeckVisible,',
  '# validateAgentKey, assertScraperServiceRequest, bridge tokens).',
  '#',
  '# If CI fails on this file: a route was added under a public prefix. Confirm it',
  '# is MEANT to be anonymous — and if it self-gates, that the gate is actually',
  '# called — then run `npm run gate:public-routes -- --write` and commit.',
  '',
].join('\n');

const body = surface.join('\n') + '\n';
const next = header + body;

if (process.argv.includes('--write')) {
  writeFileSync(SNAPSHOT, next);
  console.log(`check-public-routes: wrote ${surface.length} routes to .github/public-routes.txt`);
  process.exit(0);
}

const prev = read(SNAPSHOT);
if (!prev) {
  console.error('check-public-routes: no snapshot. Run with --write to create it.');
  process.exit(1);
}

const prevRoutes = prev.split('\n').filter((l) => l && !l.startsWith('#'));
const added = surface.filter((r) => !prevRoutes.includes(r));
const removed = prevRoutes.filter((r) => !surface.includes(r));

if (!added.length && !removed.length) {
  console.log(`check-public-routes: OK — ${surface.length} anonymously-reachable routes, unchanged.`);
  process.exit(0);
}

console.error('check-public-routes: the anonymous surface CHANGED.\n');
for (const r of added) console.error(`  + ${r}   ← now reachable without a session`);
for (const r of removed) console.error(`  - ${r}   ← no longer reachable`);
console.error(
  '\nIf these are intended, re-read them once more — an added line means anyone on\n' +
    'the internet can hit that route — then run:\n' +
    '  npm run gate:public-routes -- --write\n' +
    'and commit .github/public-routes.txt with the change.',
);
process.exit(1);
