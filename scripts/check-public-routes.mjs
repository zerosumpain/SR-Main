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

// Hook-level bypasses: paths hooks.server.ts lets through BEFORE the Auth.js
// gate, each self-authenticating in its own handler (service tokens, bridge
// tokens, HMAC). Curated deliberately rather than scraped, because the file
// also contains path checks that are the OPPOSITE of a bypass — notably
// `startsWith('/api/')`, which is the rule that ENFORCES auth on every API
// route. Scraping picked that up and declared all 300+ /api routes public,
// which is both wrong and useless.
const HOOK_BYPASSES = [
  '/dav', // Basic-Auth against webdav_credentials
  '/api/scraper/script', // SCRAPER_SERVICE_TOKEN
  '/api/jkai/prompts/hermes', // homeserv-only + SCRAPER_SERVICE_TOKEN (prompt workbench proxy)
  '/api/mcp', // bridge token (tools/list + tools/call)
  '/api/policy-engine', // POLICY_INGEST_SECRET
  '/api/claude-changelog', // POST only, ingest secret
  '/api/releases', // POST only, RELEASE_LOG_SECRET (summarise also accepts an owner session)
  '/api/data-standard-designer',
  '/api/dfe-data-strategy',
  '/api/whatsapp/inbound', // POST only, WHATSAPP_INBOUND_SECRET
  '/api/health/workflow-engine', // watchdog probe
  '/api/deepdive/index-sources',
  '/api/deepdive/reindex-facts',
  '/api/jkai/intel/backfill', // loopback + MAINTENANCE_SECRET, re-checked in the handler
  // Starting a studio build. POST only, STUDIO_SERVICE_TOKEN as a Bearer,
  // constant-time compared, refused entirely when the var is unset or under 32
  // chars — see $lib/server/studio-auth. Re-checked in the handler, which also
  // applies its own 3/hour ceiling because the hook's RATE_LIMITS pass is
  // skipped for a tokened call. Deliberately NOT loopback-gated: cloudflared
  // makes every VPS request look like 127.0.0.1, so loopback proves nothing
  // here. The action is reversible and cannot publish.
  '/api/jkai/studio', // POST only, STUDIO_SERVICE_TOKEN
  // Autonomous-builder tool bridge. HMAC-over-build-id bearer token, verified
  // in $lib/jkai/tool-bridge. Named one path at a time on purpose: the sibling
  // /api/jkai/tools/promote has NO auth of its own and must stay owner-gated.
  '/api/jkai/tools/manifest', // JKAI_BRIDGE_TOKEN
  '/api/jkai/tools/invoke', // JKAI_BRIDGE_TOKEN
];

// Path literals in hooks.server.ts that are NOT bypasses, so drift detection
// below doesn't flag them every run.
const HOOK_NON_BYPASSES = [
  '/api', // the catch-all that REQUIRES auth for APIs
  '/projects', // share-token (?t=) handling; /projects is public via PUBLIC_PATHS
];

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
  const known = new Set([...HOOK_BYPASSES, ...HOOK_NON_BYPASSES]);
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

const prefixes = [...new Set([...publicPathsFromAuth(), ...HOOK_BYPASSES])];

const missing = CANARIES.filter((c) => !prefixes.includes(c));
if (missing.length) {
  console.error(
    `check-public-routes: expected prefixes not found: ${missing.join(', ')}\n` +
      'The extraction from auth.ts / hooks.server.ts has broken — fix this script ' +
      'rather than regenerating the snapshot, or the check silently covers nothing.',
  );
  process.exit(2);
}

const isPublic = (p) => prefixes.some((pre) => p === pre || p.startsWith(pre + '/'));

const surface = walk(ROUTES)
  .map(routePath)
  .filter(isPublic)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();

const header = [
  '# Anonymously-reachable routes — GENERATED, do not hand-edit.',
  '#',
  '# Every route here can be reached WITHOUT a session, because it sits under a',
  '# prefix in PUBLIC_PATHS (src/lib/auth.ts) or a bypass in hooks.server.ts.',
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
