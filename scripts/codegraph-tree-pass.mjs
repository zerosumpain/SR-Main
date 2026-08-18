#!/usr/bin/env node
/**
 * codegraph-tree-pass.mjs — teach the graph what the tree looks like, at the
 * commit that just went live.
 *
 * WHY THIS IS SPLIT OUT OF THE BACKFILL
 *
 * The backfill does two unrelated jobs with two different data sources. The
 * history half (episodes, lessons) needs the 858 MB of Claude Code transcripts,
 * which exist only on homeserv. The tree half — which files exist, what kind
 * each is, what imports what — needs only a git tree, and pinning it to
 * homeserv's checkout is what broke it: `headFileSet()` ran `git ls-files` in a
 * working copy parked on a branch that predates codegraph, so 216 file nodes
 * were stamped as gone from the tree and **138 of them were on master**,
 * including codegraph's own `auth.ts`. The sentinel self-test could not catch
 * it, because `package.json` and `schema.ts` exist on every branch.
 *
 * So the tree pass runs in the release job, which is a self-hosted runner on
 * the VPS with a git checkout detached at the exact deployed SHA. The ref is
 * then correct by construction rather than by hoping, and a file becomes a node
 * the moment it lands rather than whenever someone remembers to run a backfill.
 *
 * Node builtins only — the release job deliberately runs no `npm ci`, exactly
 * like scripts/release-log/ingest.mjs beside it.
 *
 * Usage:
 *   CODEGRAPH_TOKEN=… node scripts/codegraph-tree-pass.mjs [--url URL] [--ref HEAD] [--dry]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const DRY = argv.includes('--dry');
const REF = flag('ref', 'HEAD');
const URL_ = flag('url', process.env.CODEGRAPH_URL || 'http://127.0.0.1:4173/api/jkai/codegraph/ingest');
const TOKEN = process.env.CODEGRAPH_TOKEN || process.env.CLAUDE_CHANGELOG_SECRET || '';
const REPO = 'SR-Main';

const TRACKED = /^(src|scripts|packages|static|docs|tests|field-study-system|\.github)\//;

/**
 * The tree AT A NAMED REF, never the working copy.
 *
 * `git ls-files` reports the index of whatever branch happens to be checked
 * out. `git ls-tree <ref>` reports a commit. That distinction is the entire bug
 * this script exists to fix, so the ref is a required concept here rather than
 * an option with a convenient default.
 */
function treeAt(ref) {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Family. Mirrors src/lib/codegraph/family.ts — duplicated for the same reason
// as the fingerprint and import rules: this is plain node with no TS build
// step. The server stamps family itself at ingest, so a drift here costs
// nothing but a wasted field; family.test.ts pins the shared cases.
// ---------------------------------------------------------------------------
const FAMILY_RULES = [
  ['api-endpoint', /^src\/routes\/api\/.*\/\+server\.ts$/],
  ['route-endpoint', /^src\/routes\/.*\/\+server\.ts$/],
  ['page-server', /^src\/routes\/.*\/\+page\.server\.ts$/],
  ['layout-server', /^src\/routes\/.*\/\+layout\.server\.ts$/],
  ['page', /^src\/routes\/.*\/\+page\.svelte$/],
  ['layout', /^src\/routes\/.*\/\+layout\.svelte$/],
  ['test', /\.(test|spec)\.[tj]sx?$/],
  ['workflow-node-def', /^src\/lib\/workflows\/nodes\/.*\.def\.ts$/],
  ['workflow-node', /^src\/lib\/workflows\/nodes\/[^/]+\.ts$/],
  ['site-tool', /^src\/lib\/workflows\/site-tools\/tools\/[^/]+\.ts$/],
  ['component', /^src\/lib\/components\/.*\.svelte$/],
  ['svelte', /\.svelte$/],
  ['db-schema', /^src\/lib\/db\/.*\.ts$/],
  ['lib-module', /^src\/lib\/.*\.ts$/],
  ['script', /^scripts\/.*\.(mjs|js|ts|sh)$/],
];
const familyOf = (p) => FAMILY_RULES.find(([, re]) => re.test(p))?.[0] ?? null;

// ---------------------------------------------------------------------------
// Static linkage. Mirrors src/lib/codegraph/imports.ts, pinned by imports.test.ts.
// ---------------------------------------------------------------------------
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTS = ['.ts', '.js', '.svelte', '.mjs', '.svelte.ts', '.json'];
const IDXS = ['/index.ts', '/index.js', '/index.svelte'];

function normPath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function resolveSpec(spec, fromPath, exists) {
  let base;
  if (spec.startsWith('$lib/')) base = 'src/lib/' + spec.slice(5);
  else if (spec === '$lib') base = 'src/lib';
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = normPath(fromPath.split('/').slice(0, -1).join('/') + '/' + spec);
  else return null;                                  // external — never a node
  if (exists.has(base)) return base;
  for (const e of EXTS) if (exists.has(base + e)) return base + e;
  for (const i of IDXS) if (exists.has(base + i)) return base + i;
  return null;
}

function subjectOfTest(path, exists) {
  const m = path.match(/^(.*)\.(test|spec)\.([tj]sx?)$/);
  if (!m) return null;
  const [, stem, , ext] = m;
  // Qualified names — `x.diagnostics.test.ts` covers `x.ts`. Mirrors
  // src/lib/codegraph/imports.ts; 91 of 342 test files need it.
  let s = stem;
  while (s) {
    for (const c of [`${s}.${ext}`, `${s}.svelte`, `${s}.ts`, `${s}.js`]) if (exists.has(c)) return c;
    const cut = s.lastIndexOf('.');
    if (cut === -1 || s.slice(cut).includes('/')) break;
    s = s.slice(0, cut);
  }
  return null;
}

async function post(payload) {
  if (DRY) {
    console.log('[dry]', { nodes: payload.nodes?.length ?? 0, edges: payload.edges?.length ?? 0 });
    return { counts: {} };
  }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  if (!TOKEN && !DRY) {
    console.error('codegraph-tree-pass: no CODEGRAPH_TOKEN / CLAUDE_CHANGELOG_SECRET — refusing to POST');
    process.exit(2);
  }

  const tracked = treeAt(REF);
  const exists = new Set(tracked);
  const files = tracked.filter((p) => TRACKED.test(p));
  const sha = execFileSync('git', ['rev-parse', '--short', REF], { encoding: 'utf8' }).trim();
  console.log(`tree pass at ${sha}: ${files.length} tracked files in scope`);

  // Every file in the tree is a live node. `existsOnHead: true` is the whole
  // point — this is the only writer that can honestly say so, because it is the
  // only one that knows which commit it is looking at.
  const nodes = files.map((p) => ({
    canonicalPath: p,
    kind: 'file',
    displayName: p.split('/').pop(),
    existsOnHead: true,
    family: familyOf(p),
  }));

  const edges = [];
  const seen = new Set();
  for (const path of files) {
    if (!/\.(ts|js|mjs|svelte)$/.test(path)) continue;
    let src;
    try { src = readFileSync(path, 'utf8'); } catch { continue; }
    if (src.length > 400_000) continue;
    const specs = new Set();
    for (const m of src.matchAll(IMPORT_RE)) { const sp = m[1] ?? m[2]; if (sp) specs.add(sp); }
    for (const sp of specs) {
      const to = resolveSpec(sp, path, exists);
      if (!to || to === path || !TRACKED.test(to)) continue;
      const k = `imports|${path}|${to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: path, target: to, kind: 'imports', weight: 1 });
    }
    const subj = subjectOfTest(path, exists);
    if (subj && TRACKED.test(subj)) {
      const k = `tests|${path}|${subj}`;
      if (!seen.has(k)) { seen.add(k); edges.push({ source: path, target: subj, kind: 'tests', weight: 1 }); }
    }
  }

  console.log(`  ${nodes.length} nodes, ${edges.length} static edges`);
  const totals = { nodes: 0, edges: 0 };
  for (let i = 0; i < nodes.length; i += 1000) {
    const r = await post({ repo: REPO, nodes: nodes.slice(i, i + 1000) });
    totals.nodes += r.counts?.nodes ?? 0;
  }
  for (let i = 0; i < edges.length; i += 1000) {
    const r = await post({ repo: REPO, edges: edges.slice(i, i + 1000) });
    totals.edges += r.counts?.edges ?? 0;
  }

  // Liveness LAST, and as one whole-tree statement rather than per batch: the
  // endpoint marks everything outside this list deleted, so a partial list
  // would retire the files that merely happened to be in another chunk.
  const live = await post({ repo: REPO, liveness: { ref: sha, paths: files } });
  console.log('tree pass done:', JSON.stringify(totals), 'liveness:', JSON.stringify(live.liveness ?? null));
}

main().catch((e) => { console.error('codegraph-tree-pass failed:', e.message); process.exit(1); });
