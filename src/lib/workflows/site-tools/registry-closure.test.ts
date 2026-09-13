import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tool registry must stay off the static import graph of JKAI's own surface.
 *
 * `./registry` imports all 52 tool modules for their `register()` side effects,
 * and through a cycle back via general-chat it reaches the workflow engine. One
 * static edge to it costs ~440 files. That is not a bug — nothing fails, the
 * closure just doubles — which is exactly why it needs asserting: it has been
 * reintroduced twice already. SR-Main #873 took the edge off chat and left it on
 * the build bridge; taking it off the bridge halved the JKAI route surface's
 * closure again, from 601 files to 303.
 *
 * The rule is what makes chat extractable: the boundary to the catalogue is one
 * async seam (`executor.ts` / `load-registry.ts`), not 52 imports, so the day it
 * becomes a call to another process that is a local change.
 *
 * Reach it through `loadToolRegistry()` or `executeSiteTool()`. A dynamic
 * `import()` is deliberately fine — it costs the same once at runtime and
 * nothing on the static graph.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');
const REGISTRY = path.join(HERE, 'registry.ts');
const EXT = ['', '.ts', '.js', '.svelte', '/index.ts', '/index.js', '.server.ts'];

/**
 * Domains that are staying in SR-Main when chat extracts, per the exclusion list
 * in SR-Infra's `registry/apps.json` (`apps.jkai-core.excludePaths`). They may
 * import the catalogue directly because they live on the same side of the
 * boundary as it does.
 */
const STAYS_IN_MAIN = [
  'routes/api/jkai/builds/',
  'routes/api/jkai/intel/',
  'routes/api/jkai/daydreams/',
  'routes/api/jkai/codegraph/',
  'routes/jkai/builds/',
  'routes/jkai/canvas/',
  'routes/jkai/codegraph/',
  'routes/jkai/daydreams/',
  'routes/jkai/develop/',
  'routes/jkai/intel/',
  'routes/jkai/knowledge/',
  'routes/jkai/notes/',
  'routes/jkai/run/',
  'routes/jkai/settings/',
  'routes/jkai/sources/',
  'routes/jkai/activity/',
];

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

/** True when the clause is erased at build — `import type`, or all-`type` specifiers. */
function erased(clause: string): boolean {
  const c = clause.trim();
  if (/^type\b/.test(c)) return true;
  const braces = c.match(/\{([\s\S]*)\}/);
  if (!braces) return false;
  if (c.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim()) return false;
  const parts = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s/.test(p));
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec === '$lib') base = path.join(SRC, 'lib');
  else if (spec.startsWith('$lib/')) base = path.join(SRC, 'lib', spec.slice(5));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of EXT) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

const cache = new Map<string, string[]>();

function staticEdges(file: string): string[] {
  const hit = cache.get(file);
  if (hit) return hit;
  let src: string;
  try {
    src = strip(fs.readFileSync(file, 'utf8'));
  } catch {
    cache.set(file, []);
    return [];
  }
  const out: string[] = [];
  for (const m of src.matchAll(/^[ \t]*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (erased(m[1])) continue;
    const r = resolveSpec(m[2], file);
    if (r) out.push(r);
  }
  for (const m of src.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) {
    const r = resolveSpec(m[1], file);
    if (r) out.push(r);
  }
  cache.set(file, out);
  return out;
}

/** The shortest static path from `entry` to `target`, or null if there is none. */
function pathTo(entry: string, target: string): string[] | null {
  const seen = new Set([entry]);
  const queue: string[][] = [[entry]];
  while (queue.length) {
    const trail = queue.shift()!;
    for (const next of staticEdges(trail[trail.length - 1])) {
      if (next === target) return [...trail, next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...trail, next]);
    }
  }
  return null;
}

function walk(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(SRC, p);
const ownedByChat = (p: string) => !STAYS_IN_MAIN.some((prefix) => rel(p).startsWith(prefix));

function offendersIn(entries: string[]): string[] {
  return entries
    .map((f) => ({ f, trail: pathTo(f, REGISTRY) }))
    .filter((x) => x.trail)
    .map((x) => `${rel(x.f)}\n      via ${x.trail!.slice(1).map(rel).join('\n       -> ')}`);
}

describe('the tool registry stays off JKAI\'s static import graph', () => {
  it('no chat-owned endpoint reaches it', () => {
    const entries = walk(path.join(SRC, 'routes/api/jkai'), (n) => n === '+server.ts').filter(ownedByChat);
    expect(entries.length).toBeGreaterThan(20);
    expect(offendersIn(entries)).toEqual([]);
  });

  it('no chat-owned page reaches it', () => {
    const entries = walk(path.join(SRC, 'routes/jkai'), (n) =>
      /^\+(page|layout)(\.server)?\.(ts|svelte)$/.test(n),
    ).filter(ownedByChat);
    expect(entries.length).toBeGreaterThan(0);
    expect(offendersIn(entries)).toEqual([]);
  });

  it('no chat transport endpoint reaches it', () => {
    // `/jkai` posts to /api/workflows/orchestrator/chat, not to /api/jkai — the
    // transport lives outside the path prefix that names the domain, and travels
    // with chat regardless.
    const base = path.join(SRC, 'routes/api/workflows/orchestrator/chat');
    expect(offendersIn(walk(base, (n) => n === '+server.ts'))).toEqual([]);
  });

  it('nothing in $lib/jkai or the chat components reaches it', () => {
    const src = (n: string) => /\.(ts|svelte)$/.test(n) && !/\.test\.ts$/.test(n);
    const entries = [
      ...walk(path.join(SRC, 'lib/jkai'), src),
      ...walk(path.join(SRC, 'lib/components/jkai'), src),
    ];
    expect(offendersIn(entries)).toEqual([]);
  });

  it('the walker can actually see the edge it is asserting the absence of', () => {
    // Otherwise a resolution bug reads as a clean boundary. `registry-internal`
    // is what every tool module imports, and `./registry` imports them all.
    const proof = pathTo(path.join(HERE, 'registry.ts'), path.join(HERE, 'registry-internal.ts'));
    expect(proof).not.toBeNull();
  });
});
