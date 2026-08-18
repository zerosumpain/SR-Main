import { describe, it, expect } from 'vitest';
import {
  precedentTargets,
  precedentQuery,
  skeleton,
  buildPrecedentBlock,
  PRECEDENT_CHARS_PER_FILE,
} from './precedent';
import { parseCgql } from './query';

describe('choosing what to find precedent for', () => {
  it('prefers what the last iteration edited over what the task names', () => {
    // Same order as planBuildQuery. A build whose retrieval and precedent
    // disagree about its own subject is worse than one with neither.
    expect(
      precedentTargets(['src/lib/a.ts'], ['src/lib/b.ts'], ['src/lib/c.ts']),
    ).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
  });

  it('dedupes and bounds', () => {
    expect(precedentTargets(['src/lib/a.ts'], ['src/lib/a.ts'], [], 2)).toEqual(['src/lib/a.ts']);
    expect(precedentTargets([], [], [])).toEqual([]);
  });

  it('asks about a file that does not exist yet', () => {
    // The whole point: a build creating the 359th route handler has nothing to
    // read and every reason to want the other 358.
    const q = precedentQuery('src/routes/api/brand/new/+server.ts', 2)!;
    expect(q).toContain('siblings:src/routes/api/brand/new/+server.ts');
    expect(() => parseCgql(q)).not.toThrow();
  });

  it('refuses a path that could widen its own query', () => {
    expect(precedentQuery('src/lib/%.ts', 2)).toBeNull();
    expect(precedentQuery('../../etc/passwd', 2)).toBeNull();
  });
});

describe('the excerpt', () => {
  it('keeps a short file whole', () => {
    expect(skeleton('const a = 1;\n')).toBe('const a = 1;');
  });

  it('cuts at a line boundary and says what it dropped', () => {
    // A cut mid-token leaves a truncated identifier that reads as a real name,
    // and an agent will faithfully copy it.
    const src = Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i};`).join('\n');
    const out = skeleton(src, 500);
    expect(out.length).toBeLessThan(700);
    expect(out).toMatch(/more line\(s\)/);
    const body = out.split('\n').slice(0, -1).join('\n');
    expect(body.endsWith(';')).toBe(true);
  });

  it('defaults to a bounded budget', () => {
    const src = 'x'.repeat(50_000);
    expect(skeleton(src).length).toBeLessThan(PRECEDENT_CHARS_PER_FILE + 200);
  });
});

describe('the block', () => {
  it('renders nothing at all when there is nothing to show', () => {
    // Unlike the codegraph push, absence here is silence: the agent has the
    // digest and its own tools, and a "no precedent" heading with no files
    // under it would spend budget saying nothing.
    expect(buildPrecedentBlock([])).toBe('');
  });

  it('fences each exemplar by its real language', () => {
    const block = buildPrecedentBlock([
      { target: 'src/routes/api/x/+server.ts', path: 'src/routes/api/y/+server.ts', source: 'export const GET = 1;' },
      { target: 'src/lib/a.svelte', path: 'src/lib/b.svelte', source: '<div />' },
    ]);
    expect(block).toContain('```ts');
    expect(block).toContain('```svelte');
    expect(block).toContain('src/routes/api/y/+server.ts');
    expect(block).toContain('Precedent for `src/routes/api/x/+server.ts`');
  });
});
