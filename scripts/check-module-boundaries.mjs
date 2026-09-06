#!/usr/bin/env node
// Module boundary lockfile for src/lib.
//
// The gap this closes: src/lib is 66 modules deep and nothing has ever stopped
// any of them importing any other. The result, measured 2026-08-27, is 26 pairs
// of modules that import EACH OTHER — including the two largest, jkai and
// workflows (76 imports one way, 16 back). Nothing about that was decided; it
// accumulated one reasonable-looking import at a time, and by the time it shows
// up as "this repo is hard to reason about" it is far too late to unpick by
// hand. So the shape has to be asserted, the way the font-size floor is.
//
// This is the cheap alternative to splitting the repo. Boundaries are what
// people actually want out of a repo split — isolation, a clear "what may
// depend on what" — and a linter gives that without N deploy pipelines onto one
// VPS directory, N copies of the visibility allow-list, or a 120-table schema
// that no single `tsc` run covers any more.
//
// WHY NOT dependency-cruiser, which is the obvious off-the-shelf answer: it
// does not parse .svelte files. Measured here on 2026-08-27 at v18.2.0, with
// $lib resolution configured and working: 647 .ts files under src/lib/workflows
// yielded 1,794 dependencies, and 47 .svelte files under src/lib/components/jkai
// yielded ZERO. It reports success on a file it cannot read. That blind spot is
// 837 of the repo's 3,568 $lib imports (23%) and it is not evenly spread —
// $lib/presentation is imported from 22 .svelte files and 10 .ts ones, so
// dependency-cruiser would have seen under a third of that module's consumers
// and called the boundary clean. A gate that passes because it looked at
// nothing is worse than no gate.
//
// It also matches the three linters already here (check-public-routes,
// check-font-sizes, check-schema-imports): node: builtins only, no dependency
// tree, so the CI "Lint gates" step keeps running at gate level L1 before
// `npm ci`.
//
// Run:  node scripts/check-module-boundaries.mjs
//       node scripts/check-module-boundaries.mjs --graph    (print the edge list)
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tests drive the rules through a fixture tree rather than real repo history,
// so the cases stay readable and do not drift as src/lib changes — the same
// trick scripts/gate-level.sh uses with GATE_LEVEL_FILES. In fixture mode the
// baselines are empty and the extraction floor is off, so a test asserts the
// RULE, not this repo's current debt.
const FIXTURE = process.env.SR_BOUNDARIES_ROOT;
const ROOT = FIXTURE ? resolve(FIXTURE) : REPO;

// ---------------------------------------------------------------------------
// The layers. A module may import its OWN layer and any layer BELOW it, never
// above. Unlisted modules default to `domain`, which is the safe default: a new
// module is free to use the platform, and blocked from reaching up into the UI.
//
// The point of the ordering is that the bottom two layers stay reusable. The
// day `$lib/db` imports `$lib/jkai`, the schema stops being something you can
// reason about on its own — and it is the ONE thing every other module depends
// on (999 imports, more than the next three modules combined).
// ---------------------------------------------------------------------------
const LAYERS = ['foundation', 'platform', 'domain', 'ui', 'routes'];

const MODULE_LAYER = {
  // foundation — the schema and the constants everything is allowed to share.
  // These import nothing but each other, today and by rule.
  db: 'foundation',
  constants: 'foundation',
  config: 'foundation',
  assets: 'foundation',
  styles: 'foundation',
  shaders: 'foundation',

  // platform — cross-cutting services with no domain knowledge. If one of these
  // needs to reach up into a feature, the dependency is pointing the wrong way:
  // the feature should be passing something in.
  server: 'platform',
  models: 'platform',
  security: 'platform',
  secrets: 'platform',
  storage: 'platform',
  'file-store': 'platform',
  datastore: 'platform',
  llm: 'platform',
  routing: 'platform',
  // The ambient AsyncLocalStorage stores — which workflow run, chat round,
  // activity or research session this code is executing inside. Platform, not
  // domain, precisely so the LLM gateway can read them without importing the
  // features that set them.
  context: 'platform',

  // ui — presentation-layer modules. Nothing below may import these; a feature
  // module that reaches for a Svelte component has put rendering in the wrong
  // place, and it is how `$lib/components` ends up unable to move.
  components: 'ui',
  landing: 'ui',

  // everything else defaults to `domain`.
};

const DEFAULT_LAYER = 'domain';
const layerOf = (mod) => MODULE_LAYER[mod] ?? DEFAULT_LAYER;
const rank = (layer) => LAYERS.indexOf(layer);

// ---------------------------------------------------------------------------
// Known violations, recorded 2026-08-27. This list may SHRINK and never grow.
// An entry that no longer matches anything is a failure, not a comment — that
// is what stops the list rotting into a permanent exemption.
//
// Each line is the debt, not the design. Fix one and delete the line.
// ---------------------------------------------------------------------------
const BASELINE_LAYER = [
  // Both of these are $lib/workflows/site-tools — the tool registry and the
  // keyword classifier — which the platform layer reaches up for. site-tools is
  // a registry of DOMAIN capabilities, so the fix is to invert it: let the
  // domain register its tools with the platform rather than the platform
  // importing the catalogue.
  'llm -> workflows',
  'routing -> workflows',

];

// R4 exceptions: API routes reusing a project page's lib. Each of these four is
// an /api/<slug> endpoint importing src/routes/projects/<slug>/lib — the study
// page and its endpoint were built as one unit. The shared code belongs in
// src/lib/<slug>, where the layer rules above would apply to it.
// None. Four /api/<slug> endpoints used to import their study page's lib/
// directory; the shared halves now live in $lib/<slug>/ where the layer rules
// apply to them, and page-only state stayed beside the page.
const BASELINE_ROUTE_CROSS = [];

// Mutual imports between two lib modules, alphabetical, ' <-> ' separated.
// Twenty pairs is the tangle this linter exists to stop growing.
const BASELINE_CYCLES = [
  'agents <-> workflows',
  'apis <-> workflows',
  'blog <-> voice',
  'builds <-> canvas',
  'canvas <-> workflows',
  'codegraph <-> jkai',
  'daydream <-> heartbeat',
  'daydream <-> workflows',
  'deepdive <-> jkai',
  'deepdive <-> workflows',
  'file-index <-> jkai',
  'health <-> trails',
  'health <-> workflows',
  'heartbeat <-> workflows',
  'jkai <-> workflows',
  // Was 'jkai <-> server' before the gateway moved down — the same knot, now
  // between two platform modules. $lib/llm/client asks server/models which
  // model to use; server/models/codex-catalogue asks $lib/llm what it cost.
  'llm <-> server',
  'llm <-> workflows',
  'mcp <-> toolpolicy',
  'models <-> server',
  'monitors <-> workflows',
  'node-builder <-> workflows',
  'routing <-> server',
  'selfimprove <-> workflows',
];

// Sanity floor. If the extraction stops matching — a syntax change, a bad
// regex, a git ls-files that returns nothing — this linter would report a clean
// tree and every rule above would silently stop existing. An over-matching
// regex once declared all 391 API routes public; the same class of failure here
// is quieter, because nothing visibly breaks. Fix the extraction, do not lower
// the number.
const MIN_EDGES = 6500;

// ---------------------------------------------------------------------------

function walk(dir, base = '') {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else out.push(`src/${rel}`);
  }
  return out;
}

const files = (
  FIXTURE
    ? walk('src')
    : execFileSync('git', ['ls-files', 'src/**/*.ts', 'src/**/*.js', 'src/**/*.svelte'], {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }).split('\n')
)
  .filter(Boolean)
  .filter((f) => /\.(ts|js|svelte)$/.test(f))
  // A test file is not part of its module's dependency surface: a test for
  // $lib/server may legitimately reach for a fixture anywhere, and counting
  // those turns the baseline into noise about nothing architectural.
  .filter((f) => !/\.(test|spec)\.(ts|js)$/.test(f));

// `from '…'`, `import('…')`, and bare `import '…'`. The `from` arm also covers
// `export { x } from '…'` and `export * from '…'`, which are how a barrel file
// re-exports across a boundary — the exact move this needs to see.
const IMPORT_RE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;

// Comments are stripped first: a commented-out import is not a dependency, and
// counting one would fail the gate over a line that does not execute.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

/** Which src/lib module owns a repo-relative path, or a route/other marker. */
function ownerOf(file) {
  let m = file.match(/^src\/lib\/([^/]+)\//);
  if (m) return { kind: 'lib', name: m[1] };
  if (/^src\/lib\/[^/]+$/.test(file)) return { kind: 'lib-root', name: ':lib-root' };
  m = file.match(/^src\/routes\/(.+)$/);
  if (m) return { kind: 'route', name: routeKey(m[1]) };
  return null;
}

// A route "module" is its top-level segment, except under src/routes/api where
// the first two segments are the real unit — /api/jkai and /api/health are as
// unrelated as /jkai and /health are.
function routeKey(rest) {
  const parts = rest.split('/');
  // A file directly in src/routes (+page.svelte, +layout.svelte, rss.xml) is
  // the root route, not a route named after itself.
  if (parts.length === 1) return ':root';
  if (parts[0] === 'api' && parts.length > 2) return `api/${parts[1]}`;
  return parts[0];
}

/** Resolve an import specifier to a repo-relative path, or null if external. */
function resolveSpecifier(spec, fromFile) {
  // SvelteKit generates ./$types next to every route file. It is not a route.
  if (spec === '$types' || spec.endsWith('/$types')) return null;
  if (spec.startsWith('$lib/')) return `src/lib/${spec.slice(5)}`;
  if (spec === '$lib') return 'src/lib';
  if (spec.startsWith('.')) {
    const p = normalize(join(dirname(fromFile), spec));
    return p.startsWith('src/') ? p : null;
  }
  return null; // $app/*, $env/*, node:*, bare packages
}

const edges = new Map(); // "a|b" -> { count, examples: [] }
let scanned = 0;

for (const file of files) {
  const from = ownerOf(file);
  if (!from) continue;
  let src;
  try {
    src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
  } catch {
    continue;
  }
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const target = resolveSpecifier(spec, file);
    if (!target) continue;
    const to = ownerOf(target) ?? (target === 'src/lib' ? { kind: 'lib-root', name: ':lib-root' } : null);
    if (!to) continue;
    scanned++;
    if (from.name === to.name) continue;
    const key = `${from.kind}:${from.name}|${to.kind}:${to.name}`;
    if (!edges.has(key)) edges.set(key, { count: 0, examples: [] });
    const e = edges.get(key);
    e.count++;
    if (e.examples.length < 3) e.examples.push(`${file}  →  ${spec}`);
  }
}

if (process.argv.includes('--graph')) {
  for (const [k, v] of [...edges].sort((a, b) => b[1].count - a[1].count)) {
    console.log(String(v.count).padStart(5), k.replace('|', '  ->  '));
  }
  process.exit(0);
}

if (!FIXTURE && scanned < MIN_EDGES) {
  console.error(
    `check-module-boundaries: only resolved ${scanned} intra-src imports, expected at ` +
      `least ${MIN_EDGES} across ${files.length} files. The extraction has stopped ` +
      'matching — fix it, do not lower the floor.'
  );
  process.exit(2);
}

// --- rules ------------------------------------------------------------------

const LAYER_EXCEPTIONS = FIXTURE ? [] : BASELINE_LAYER;
const ROUTE_EXCEPTIONS = FIXTURE ? [] : BASELINE_ROUTE_CROSS;
const CYCLE_EXCEPTIONS = FIXTURE ? [] : BASELINE_CYCLES;

const violations = [];
const usedLayerBaseline = new Set();
const usedCycleBaseline = new Set();
const usedRouteBaseline = new Set();

const libEdge = new Map(); // "a|b" for lib->lib, for the cycle rule
for (const [key, info] of edges) {
  const [fromRaw, toRaw] = key.split('|');
  const [fromKind, fromName] = splitOnce(fromRaw);
  const [toKind, toName] = splitOnce(toRaw);

  // R1–R3: layering. :lib-root is a grab-bag of loose files and is exempt until
  // it is emptied.
  //
  // Routes count as the TOP layer here, which is what makes `$lib` importing a
  // route a violation. That direction went unchecked until 2026-08-28 and it is
  // the worst one available: a shared library that depends on a page cannot be
  // reused, cannot be tested without the route tree, and quietly makes a page
  // load-bearing for everything downstream of it. It was live —
  // $lib/workflows/site-tools/tools/site-signals.ts reached four levels up into
  // src/routes/projects/policy-engine for a tracking module.
  if ((fromKind === 'lib' || fromKind === 'route') && (toKind === 'lib' || toKind === 'route')) {
    if (fromKind === 'lib' && toKind === 'lib') libEdge.set(`${fromName}|${toName}`, info);
    const fl = fromKind === 'route' ? 'routes' : layerOf(fromName);
    const tl = toKind === 'route' ? 'routes' : layerOf(toName);
    // route -> route is R4's business, not the layer rule's (both are `routes`,
    // so the rank check would never fire on them anyway).
    if (rank(tl) > rank(fl)) {
      const label = `${fromName} -> ${toKind === 'route' ? `routes/${toName}` : toName}`;
      if (LAYER_EXCEPTIONS.includes(label)) usedLayerBaseline.add(label);
      else
        violations.push({
          rule:
            toKind === 'route'
              ? `${fl} may not import a ROUTE — move the shared code into src/lib`
              : `${fl} may not import ${tl}`,
          label,
          info,
        });
    }
  }

  // R4: no route may import another route's files. Routes are leaves — shared
  // code belongs in src/lib, where the layer rules above apply to it.
  if (fromKind === 'route' && toKind === 'route') {
    const label = `${fromName} -> ${toName}`;
    if (ROUTE_EXCEPTIONS.includes(label)) usedRouteBaseline.add(label);
    else
      violations.push({
        rule: 'a route may not import another route (move the shared code to src/lib)',
        label,
        info,
      });
  }
}

// R5: no NEW mutual imports between lib modules.
const pairsSeen = new Set();
for (const key of libEdge.keys()) {
  const [a, b] = key.split('|');
  if (!libEdge.has(`${b}|${a}`)) continue;
  const label = [a, b].sort().join(' <-> ');
  if (pairsSeen.has(label)) continue;
  pairsSeen.add(label);
  if (CYCLE_EXCEPTIONS.includes(label)) usedCycleBaseline.add(label);
  else
    violations.push({
      rule: 'these two modules import each other — neither can be understood, tested or moved alone',
      label,
      info: libEdge.get(key),
    });
}

// A baseline entry that no longer matches is stale. Failing on it is the only
// thing that makes the list shrink: without this, a fixed violation leaves a
// permanent exemption behind and the next one to reappear sails through.
const stale = [
  ...LAYER_EXCEPTIONS.filter((l) => !usedLayerBaseline.has(l)),
  ...ROUTE_EXCEPTIONS.filter((l) => !usedRouteBaseline.has(l)),
  ...CYCLE_EXCEPTIONS.filter((l) => !usedCycleBaseline.has(l)),
];

function splitOnce(s) {
  const i = s.indexOf(':');
  return [s.slice(0, i), s.slice(i + 1)];
}

// --- report -----------------------------------------------------------------

if (!violations.length && !stale.length) {
  console.log(
    `check-module-boundaries: OK — ${scanned} imports across ${files.length} files, ` +
      `${BASELINE_LAYER.length + BASELINE_ROUTE_CROSS.length} layer + ${BASELINE_CYCLES.length} cycle exceptions outstanding.`
  );
  process.exit(0);
}

if (stale.length) {
  console.error(
    `check-module-boundaries: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} stale — ` +
      'the violation is gone. Delete the line(s) from scripts/check-module-boundaries.mjs:\n'
  );
  for (const s of stale) console.error(`  ${s}`);
  console.error('');
}

if (violations.length) {
  console.error(`check-module-boundaries: ${violations.length} new boundary violation(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.label}`);
    console.error(`    ${v.rule}`);
    for (const ex of v.info.examples) console.error(`      ${ex}`);
    console.error('');
  }
  console.error(
    'Layers (a module may import its own layer and below, never above):\n' +
      `  ${LAYERS.join('  <  ')}\n\n` +
      'Fixes, in order of preference:\n' +
      '  1. Invert it — pass the value in from the caller instead of importing upward.\n' +
      '  2. Move the shared thing DOWN a layer (usually into $lib/constants or its own\n' +
      '     platform module) so both sides import it rather than each other.\n' +
      '  3. Re-layer the module in MODULE_LAYER, if it genuinely sits somewhere else.\n' +
      '  4. Last resort: add it to the baseline, with the reason it cannot be fixed now.\n\n' +
      'See the whole graph with:  node scripts/check-module-boundaries.mjs --graph'
  );
}

process.exit(1);
