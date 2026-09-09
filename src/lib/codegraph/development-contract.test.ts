import { describe, it, expect } from 'vitest';
import { renderContext, type RetrievalResult } from './retrieve';
import { parseCgql } from './query';
import { relevanceOf } from './relevance';
import { impactOf, type StructuralSnapshot } from './snapshot';
import { contextDeadline } from './deadline';
import { scipRelationships } from '../../../scripts/lib/codegraph-scip.mjs';
import { analyseSources } from '../../../scripts/lib/codegraph-snapshot.mjs';
import { evaluateRetrieval, replayCases, compareBuildOutcomes } from '../../../scripts/lib/codegraph-evaluation.mjs';

const snapshot = { files: ['src/a.ts', 'src/b.ts', 'src/a.test.ts'], edges: [
  { source: 'src/b.ts', target: 'src/a.ts', kind: 'imports' },
  { source: 'src/a.test.ts', target: 'src/a.ts', kind: 'tests' },
], routes: [], dependencies: [] } as unknown as StructuralSnapshot;
describe('development code evidence', () => {
  it('records only evidence that fits, including formatting in the hard budget', () => {
    const result: RetrievalResult = { plan: parseCgql('topic:"build errors" | budget 1000'), seedNodeIds: [], nodes: [], episodes: [], outcome: 'served', durationMs: 0,
      lessons: Array.from({ length: 5 }, (_, i) => ({ id: `lesson-${i}`, title: `Rule ${i}`, body: String(i).repeat(1000), citedPaths: [], origin: 'manual', relevance: relevanceOf({ served: 0, helpful: 0, unhelpful: 0, observedAt: null }) })) };
    const rendered = renderContext(result);
    expect(rendered.block.length).toBeLessThanOrEqual(1000);
    expect(rendered.omittedLessonIds.length).toBeGreaterThan(0);
    for (const lesson of result.lessons) expect(rendered.block.includes(`**${lesson.title}**`)).toBe(rendered.lessonIds.includes(lesson.id));
  });
  it('distinguishes uses from used-by and retains unknown coverage', () => {
    expect(impactOf(snapshot, ['src/a.ts']).dependants).toEqual(['src/b.ts']);
    expect(impactOf(snapshot, ['src/a.ts']).uses).toEqual([]);
    expect(impactOf(snapshot, ['src/b.ts']).uses).toEqual(['src/a.ts']);
    expect(impactOf(snapshot, ['src/a.ts']).tests).toEqual(['src/a.test.ts']);
    expect(impactOf(snapshot, ['src/new.ts']).coverage).toContain('unknown coverage');
  });
  it('indexes imports, test pairs, routes and exact locked package versions', () => {
    const files = ['src/a.ts', 'src/a.test.ts', 'src/routes/x/+page.svelte', 'package-lock.json'];
    const analysed = analyseSources(files, { 'src/a.ts': "import x from 'example';\nimport fs from 'fs';", 'src/a.test.ts': "import './a';", 'package-lock.json': JSON.stringify({ packages: { 'node_modules/example': { version: '1.2.3', license: 'MIT' } } }) });
    expect(analysed.edges).toContainEqual({ source: 'src/a.test.ts', target: 'src/a.ts', kind: 'tests' });
    expect(analysed.dependencies).toHaveLength(1);
    expect(analysed.dependencies[0]).toMatchObject({ name: 'example', version: '1.2.3', license: 'MIT' });
    expect(analysed.routes).toContainEqual({ path: 'src/routes/x/+page.svelte', route: '/x' });
  });
  it('imports SCIP reference direction without treating local symbols as cross-file facts', () => {
    const semantic = scipRelationships({ documents: [
      { relative_path: 'src/a.ts', occurrences: [{ symbol: 'package a', symbol_roles: 1 }, { symbol: 'local 1', symbol_roles: 1 }] },
      { relative_path: 'src/b.ts', occurrences: [{ symbol: 'package a', symbol_roles: 0 }, { symbol: 'local 1', symbol_roles: 0 }] },
    ] }, ['src/a.ts', 'src/b.ts']);
    expect(semantic.edges).toEqual([{ source: 'src/b.ts', target: 'src/a.ts', kind: 'references' }]);
    expect(parseCgql('uses:src/a.ts').seed).toEqual({ type: 'uses', path: 'src/a.ts' });
    expect(parseCgql('used-by:src/a.ts').seed.type).toBe('used-by');
  });
  it('signals a timeout to prevent late context publication', async () => {
    let signal: AbortSignal | undefined;
    await expect(contextDeadline(async s => { signal = s; await new Promise(r => setTimeout(r, 40)); s.throwIfAborted(); }, 5)).rejects.toThrow('deadline');
    expect(signal?.aborted).toBe(true);
  });
  it('keeps unknown metrics unknown and prevents evaluation hindsight', () => {
    expect(evaluateRetrieval({ expected: ['a', 'b'], retrieved: ['a', 'c'] })).toMatchObject({ precision: 0.5, recall: 0.5 });
    expect(() => replayCases([{ id: 'future', snapshotRevision: 'x', availableAt: '2026-09-10', taskAt: '2026-09-09' }], () => [])).toThrow('before');
    const groups = compareBuildOutcomes([{ taskKind: 'route', model: 'a', budget: 100, policy: 'v2', costUsd: 1 }, { taskKind: 'route', model: 'b', budget: 100, policy: 'v2' }]);
    expect(groups).toHaveLength(2); expect(groups[1].metrics).toEqual({});
  });
});
