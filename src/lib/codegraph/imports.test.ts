import { describe, it, expect } from 'vitest';
import { resolveSpecifier, specifiersIn, subjectOfTest, staticEdges } from './imports';

const exists = new Set([
  'src/lib/jkai/executor.ts',
  'src/lib/jkai/prompt.ts',
  'src/lib/db/index.ts',
  'src/lib/components/intel/NetworkGraph.svelte',
  'src/lib/codegraph/query.ts',
  'src/lib/codegraph/query.test.ts',
  'src/routes/api/x/+server.ts',
]);

describe('specifier extraction', () => {
  it('finds static, side-effect-free and dynamic imports', () => {
    const src = `
      import { a } from '$lib/jkai/executor';
      import type { B } from './prompt';
      export { c } from '../db';
      const m = await import('$lib/codegraph/query');
    `;
    expect(specifiersIn(src)).toEqual([
      '$lib/jkai/executor',
      './prompt',
      '../db',
      '$lib/codegraph/query',
    ]);
  });

  it('does not treat the word import inside a string or comment as a dependency', () => {
    // Not a parser, so this is the honest limit of the regex — assert what it
    // actually does rather than pretending otherwise.
    const src = `const msg = "run npm ci before import";\nimport x from './prompt';`;
    expect(specifiersIn(src)).toEqual(['./prompt']);
  });

  it('dedupes repeated specifiers', () => {
    const src = `import a from './prompt';\nimport b from './prompt';`;
    expect(specifiersIn(src)).toEqual(['./prompt']);
  });
});

describe('resolution', () => {
  it('resolves $lib and relative paths, trying real extensions', () => {
    expect(resolveSpecifier('$lib/jkai/executor', 'src/routes/api/x/+server.ts', exists)).toBe(
      'src/lib/jkai/executor.ts',
    );
    expect(resolveSpecifier('./prompt', 'src/lib/jkai/executor.ts', exists)).toBe(
      'src/lib/jkai/prompt.ts',
    );
    expect(resolveSpecifier('$lib/components/intel/NetworkGraph.svelte', 'a.ts', exists)).toBe(
      'src/lib/components/intel/NetworkGraph.svelte',
    );
  });

  it('falls back to an index file', () => {
    expect(resolveSpecifier('$lib/db', 'src/lib/jkai/executor.ts', exists)).toBe('src/lib/db/index.ts');
  });

  it('collapses .. segments', () => {
    expect(resolveSpecifier('../db', 'src/lib/jkai/executor.ts', exists)).toBe('src/lib/db/index.ts');
  });

  it('returns null for anything external — never invents a node', () => {
    // An edge to a node that does not exist is worse than no edge: ensureNodes
    // would mint a phantom file for it and it would show up on the map.
    for (const spec of ['drizzle-orm', '$app/environment', 'node:fs', 'three', '$env/dynamic/private']) {
      expect(resolveSpecifier(spec, 'src/lib/jkai/executor.ts', exists), spec).toBeNull();
    }
  });

  it('returns null when the target genuinely is not in the tree', () => {
    expect(resolveSpecifier('./deleted-helper', 'src/lib/jkai/executor.ts', exists)).toBeNull();
  });
});

describe('test ↔ subject', () => {
  it('pairs a test with its subject by convention', () => {
    expect(subjectOfTest('src/lib/codegraph/query.test.ts', exists)).toBe('src/lib/codegraph/query.ts');
  });

  it('is null when the subject is absent, and for non-tests', () => {
    expect(subjectOfTest('src/lib/gone.test.ts', exists)).toBeNull();
    expect(subjectOfTest('src/lib/codegraph/query.ts', exists)).toBeNull();
  });
});

describe('whole-tree edges', () => {
  const files = new Map([
    ['src/lib/jkai/executor.ts', `import { p } from './prompt';\nimport { db } from '$lib/db';\nimport z from 'drizzle-orm';`],
    ['src/lib/jkai/prompt.ts', `export const p = 1;`],
    ['src/lib/db/index.ts', `export const db = 1;`],
    ['src/lib/codegraph/query.ts', `export const q = 1;`],
    ['src/lib/codegraph/query.test.ts', `import { q } from './query';`],
  ]);

  it('emits directional import edges and skips externals', () => {
    const edges = staticEdges(files);
    const imports = edges.filter((e) => e.kind === 'imports');
    expect(imports).toContainEqual({ from: 'src/lib/jkai/executor.ts', to: 'src/lib/jkai/prompt.ts', kind: 'imports' });
    expect(imports).toContainEqual({ from: 'src/lib/jkai/executor.ts', to: 'src/lib/db/index.ts', kind: 'imports' });
    // drizzle-orm is external — no edge, and no phantom node.
    expect(imports.every((e) => files.has(e.to))).toBe(true);
  });

  it('emits a tests edge alongside the import the test also makes', () => {
    const edges = staticEdges(files);
    expect(edges).toContainEqual({
      from: 'src/lib/codegraph/query.test.ts',
      to: 'src/lib/codegraph/query.ts',
      kind: 'tests',
    });
    expect(edges).toContainEqual({
      from: 'src/lib/codegraph/query.test.ts',
      to: 'src/lib/codegraph/query.ts',
      kind: 'imports',
    });
  });

  it('never emits a self-edge', () => {
    const self = new Map([['src/a.ts', `import x from './a';`]]);
    expect(staticEdges(self)).toEqual([]);
  });
});

describe('qualified test names', () => {
  const exists = new Set([
    'src/lib/jkai/test-runner.ts',
    'src/lib/apis/integrations.ts',
    'src/lib/canvas/palette.ts',
    'src/lib/a.ts',
  ]);

  it('peels a qualifier to reach the real subject', () => {
    // 91 of 342 test files here are named this way, including the one whose
    // subject builds kept guessing wrong.
    expect(subjectOfTest('src/lib/jkai/test-runner.diagnostics.test.ts', exists))
      .toBe('src/lib/jkai/test-runner.ts');
    expect(subjectOfTest('src/lib/apis/integrations.status.test.ts', exists))
      .toBe('src/lib/apis/integrations.ts');
  });

  it('returns null for a test with no subject at all', () => {
    // `palette-parity` is not `palette`. Peeling stops at dots, and a hyphen
    // is part of the name — otherwise every test would find a subject.
    expect(subjectOfTest('src/lib/canvas/palette-parity.test.ts', exists)).toBeNull();
  });

  it('never peels across a directory boundary', () => {
    // `a/b.test.ts` must not resolve to `a.ts`.
    expect(subjectOfTest('src/lib/a/b.test.ts', new Set(['src/lib/a.ts']))).toBeNull();
  });
});
