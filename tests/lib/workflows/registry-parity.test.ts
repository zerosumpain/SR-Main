import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { nodeDefinitions } from '$lib/workflows/registry-client';

/**
 * Drift guard for the hand-written client node list.
 *
 * `src/lib/workflows/registry-client.ts` maintains a client-safe list of node
 * definitions (`nodeDefinitions`) that MUST mirror the executors registered in
 * `src/lib/workflows/index.ts`. Because the client list is hand-maintained
 * (some defs are inlined / imported from `.def.ts` to keep the bundle free of
 * server-only code), it can silently drift from the registered executors.
 *
 * This test recovers the authoritative *registered* set by statically parsing
 * the `registry.register(<Def>, ...)` calls in `index.ts` and resolving each
 * `<Def>` to its `type` string from the source file(s) that declare it. No
 * runtime module other than `registry-client` is imported (importing `index.ts`
 * would trigger its boot side-effects), so the guard runs purely off source
 * text and never touches the production startup path.
 *
 * If this test fails, reconcile `registry-client.ts` with the registered
 * executors (add the missing def, or remove the stale one).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/lib/workflows -> repo root is three levels up.
const WORKFLOWS_DIR = resolve(HERE, '../../../src/lib/workflows');

/**
 * Node types that are registered server-side but intentionally NOT surfaced in
 * the client palette list. Keep this empty unless there is a deliberate
 * server-only node; document the reason here when adding one.
 */
const SERVER_ONLY_TYPES = new Set<string>([]);

function readSource(relPath: string): string {
  return readFileSync(resolve(WORKFLOWS_DIR, relPath), 'utf8');
}

/**
 * Resolve a workflow-relative import specifier to every candidate on-disk
 * source file. A spec like `./nodes/code-execute` can be backed by both
 * `code-execute.ts` (which may re-export the def) and `code-execute.def.ts`
 * (which declares it), so return all that exist.
 */
function candidateSources(spec: string): string[] {
  const rel = spec.replace(/^\.\//, '');
  const out: string[] = [];
  for (const candidate of [`${rel}.ts`, `${rel}.def.ts`, `${rel}/index.ts`]) {
    try {
      out.push(readSource(candidate));
    } catch {
      /* not present */
    }
  }
  return out;
}

/**
 * Extract the `type: '...'` literal for a `*Def` export, handling the two
 * forms used in this codebase:
 *   1. `export const fooDef: NodeDefinition = { type: 'foo', ... }`
 *   2. `export const fooDef = fooDef_;` re-export, where the real def with the
 *      `type` literal lives in a sibling source (e.g. the `.def.ts`).
 */
function typeForDefExport(sources: string[], exportName: string): string | undefined {
  // Form 1: direct literal in any candidate source.
  const directRe = new RegExp(
    `export\\s+const\\s+${exportName}\\b[^=]*=\\s*\\{`,
  );
  for (const source of sources) {
    const m = directRe.exec(source);
    if (m) {
      const after = source.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const tm = /type:\s*['"]([a-zA-Z0-9_-]+)['"]/.exec(after);
      if (tm) return tm[1];
    }
  }
  // Form 2: `export const fooDef = <alias>;` — the def literal is declared
  // (possibly under a different local name) in one of the candidate sources.
  // Fall back to scanning every candidate for any single-def literal that
  // carries a `type:` field. This is safe here because each node source file
  // declares exactly one node definition object.
  for (const source of sources) {
    const m = /:\s*NodeDefinition\s*=\s*\{/.exec(source);
    if (m) {
      const after = source.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const tm = /type:\s*['"]([a-zA-Z0-9_-]+)['"]/.exec(after);
      if (tm) return tm[1];
    }
  }
  return undefined;
}

/**
 * Build a map of exported `*Def` variable name -> import module specifier from
 * `index.ts`, covering both single-line and multi-line `import { ... }` forms.
 */
function buildImportMap(indexSrc: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(indexSrc)) !== null) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const spec = m[2];
    if (!spec.startsWith('./nodes/')) continue;
    for (const name of names) {
      if (name.endsWith('Def')) map.set(name, spec);
    }
  }
  return map;
}

function registeredTypes(): string[] {
  const indexSrc = readSource('index.ts');
  const importMap = buildImportMap(indexSrc);

  const regRe = /registry\.register\(\s*([A-Za-z0-9_]+)\s*,/g;
  const types: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regRe.exec(indexSrc)) !== null) {
    const defName = m[1];
    // Skip the dynamic-node loop's `registry.register(def, executor)`.
    if (defName === 'def') continue;
    const spec = importMap.get(defName);
    if (!spec) {
      throw new Error(`registry-parity: no import found for registered def "${defName}"`);
    }
    const sources = candidateSources(spec);
    if (sources.length === 0) {
      throw new Error(`registry-parity: cannot resolve module source for "${spec}"`);
    }
    const type = typeForDefExport(sources, defName);
    if (!type) {
      throw new Error(
        `registry-parity: could not resolve type for "${defName}" (from "${spec}")`,
      );
    }
    types.push(type);
  }
  return types;
}

describe('workflow node registry parity', () => {
  it('parses a sane number of registered types with no duplicates', () => {
    const types = registeredTypes();
    expect(types.length).toBeGreaterThan(50);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every registered executor type has a matching client def', () => {
    const registered = new Set(
      registeredTypes().filter((t) => !SERVER_ONLY_TYPES.has(t)),
    );
    const client = new Set(nodeDefinitions.map((d) => d.type));

    const missingFromClient = [...registered].filter((t) => !client.has(t)).sort();
    expect(
      missingFromClient,
      `Registered executors missing from registry-client nodeDefinitions: ${missingFromClient.join(', ')}`,
    ).toEqual([]);
  });

  it('every client def maps to a registered executor', () => {
    const registered = new Set(registeredTypes());
    const client = nodeDefinitions.map((d) => d.type);

    const extraInClient = client
      .filter((t) => !registered.has(t) && !SERVER_ONLY_TYPES.has(t))
      .sort();
    expect(
      extraInClient,
      `Client nodeDefinitions not registered as executors: ${extraInClient.join(', ')}`,
    ).toEqual([]);
  });

  it('client def list has no duplicate types', () => {
    const client = nodeDefinitions.map((d) => d.type);
    expect(new Set(client).size).toBe(client.length);
  });
});
