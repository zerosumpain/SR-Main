import { describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '$lib/db';
import { eq, inArray } from 'drizzle-orm';
import { codegraphSnapshots, codegraphNodes, codegraphEdges, codegraphQueries, codegraphLessons, jkaiBuilds, jkaiIterations, jkaiBuildDeliveries, jkaiBuildLessons, codegraphEpisodes } from '$lib/db/schema';
import { saveSnapshot } from './snapshot.server';
import { observeDevelopmentAcceptance, contextForBuild } from './development.server';
import { newDelivery } from '$lib/jkai/development';
import { resolveBuildServes } from './feedback';
import type { StructuralSnapshot } from './snapshot';
const local = process.env.JKAI_LOCAL_TESTS === '1' && /^postgresql:\/\/jkai_local:.*@127\.0\.0\.1:15435\/jkai_local$/.test(process.env.DATABASE_URL ?? '');
describe.skipIf(!local)('isolated CodeGraph persistence', () => {
  it('replaces obsolete static edges, preserves history, and isolates candidate liveness', async () => {
    const repo = `test-${randomUUID()}`;
    const files = ['src/a.ts', 'src/b.ts'];
    const snapshot: StructuralSnapshot = { repo, revision: 'a'.repeat(40), version: 1, complete: true, fileCount: 2, files,
      hashes: Object.fromEntries(files.map(p => [p, '1'.repeat(40)])), manifestHash: createHash('sha256').update(files.join('\n')).digest('hex'),
      edges: [{ source: files[0], target: files[1], kind: 'imports' }], routes: [], dependencies: [], unresolved: [], limitations: [] };
    try {
      const originalId = await saveSnapshot(snapshot, 'owned');
      expect(await saveSnapshot(snapshot, 'owned')).toBe(originalId);
      const nodes = await db.select().from(codegraphNodes).where(eq(codegraphNodes.repo, repo));
      await db.insert(codegraphEdges).values({ sourceId: nodes[0].id, targetId: nodes[1].id, kind: 'co_change', weight: 2 });
      await saveSnapshot({ ...snapshot, revision: 'b'.repeat(40), edges: [] }, 'candidate');
      expect((await db.select().from(codegraphEdges).where(eq(codegraphEdges.sourceId, nodes[0].id)))).toHaveLength(2);
      const enrichedId = await saveSnapshot({ ...snapshot, edges: [] }, 'owned');
      expect(enrichedId).not.toBe(originalId);
      const indexes = await db.select().from(codegraphSnapshots).where(eq(codegraphSnapshots.repo, repo));
      expect(indexes.find(s => s.id === originalId)?.payload.edges).toHaveLength(1);
      expect(indexes.find(s => s.id === enrichedId)?.active).toBe(true);
      expect(indexes.find(s => s.id === originalId)?.active).toBe(false);
      await saveSnapshot({ ...snapshot, revision: 'c'.repeat(40), edges: [] }, 'owned');
      expect((await db.select().from(codegraphEdges).where(eq(codegraphEdges.sourceId, nodes[0].id))).map(e => e.kind)).toEqual(['co_change']);
    } finally {
      await db.delete(codegraphSnapshots).where(eq(codegraphSnapshots.repo, repo));
      await db.delete(codegraphNodes).where(eq(codegraphNodes.repo, repo));
    }
  });
  it('concurrent gate receipts credit injected evidence exactly once', async () => {
    const id = randomUUID(); const lessonId = randomUUID(); const iterationId = randomUUID();
    try {
      await db.insert(jkaiBuilds).values({ id, prompt: 'Synthetic local feedback test', status: 'paused' });
      await db.insert(jkaiIterations).values({ id: iterationId, buildId: id, number: 1 });
      await db.insert(codegraphLessons).values({ id: lessonId, title: 'Synthetic', body: 'Synthetic' });
      await db.insert(codegraphQueries).values({ buildId: id, iterationId, channel: 'push', query: 'fingerprint:typecheck:TS2345', outcome: 'served', lessonIds: [lessonId], servedFor: ['typecheck:TS2345'] });
      const receipt = { buildId: id, iterationId, nextEvaluation: 'All checks passed', nextGatePassed: true, revision: 'a'.repeat(40) };
      await Promise.all([resolveBuildServes(receipt), resolveBuildServes(receipt)]);
      const [lesson] = await db.select().from(codegraphLessons).where(eq(codegraphLessons.id, lessonId));
      expect(lesson.helpfulCount).toBe(1);
      const [query] = await db.select().from(codegraphQueries).where(eq(codegraphQueries.buildId, id));
      expect(query.evidence.observation).toMatchObject({ revision: receipt.revision, passed: true });
    } finally {
      await db.delete(codegraphQueries).where(eq(codegraphQueries.buildId, id));
      await db.delete(codegraphLessons).where(eq(codegraphLessons.id, lessonId));
      await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id));
    }
  });
  it('retains accepted lesson identity and records local acceptance as local evidence', async () => {
    const id = randomUUID(); let lessonId: number | undefined;
    const file = `src/synthetic-${id}.ts`;
    const state = newDelivery(`Synthetic task about ${file}`);
    state.acceptedAt = new Date().toISOString(); state.candidate = 'a'.repeat(40); state.batch = 'b'.repeat(40);
    state.stage = 'accepted'; state.changes = { files: [file], patch: 'Synthetic fixture' };
    state.gate = { passed: true, revision: state.candidate, evidence: 'Synthetic local gate receipt' };
    try {
      await db.insert(jkaiBuilds).values({ id, prompt: state.brief.outcome, status: 'paused' });
      await db.insert(jkaiBuildDeliveries).values({ buildId: id, state });
      const [saved] = await db.insert(jkaiBuildLessons).values({ buildId: id, area: 'Platform', lesson: 'Synthetic validated lesson', evidence: `Synthetic evidence for ${file}`, revision: state.candidate, expiresAt: new Date(Date.now() + 86400000) }).returning();
      lessonId = saved.id;
      await observeDevelopmentAcceptance(id); await observeDevelopmentAcceptance(id);
      const lessons = await db.select().from(codegraphLessons).where(eq(codegraphLessons.id, `development-lesson:${lessonId}`));
      expect(lessons).toHaveLength(1); expect(lessons[0].body).toContain('Production deployment is not established');
      await saveSnapshot({ version: 1, repo: 'SR-Main', revision: state.candidate, complete: true, fileCount: 1, files: [file],
        hashes: { [file]: '1'.repeat(40) }, manifestHash: createHash('sha256').update(file).digest('hex'), edges: [], routes: [], dependencies: [], unresolved: [], limitations: [] }, 'candidate', id);
      const iterationId = randomUUID();
      await db.insert(jkaiIterations).values({ id: iterationId, buildId: id, number: 1 });
      const packed = await contextForBuild(id, iterationId);
      expect(packed.block).toContain('Synthetic validated lesson');
      const [recorded] = await db.select().from(codegraphQueries).where(eq(codegraphQueries.buildId, id));
      expect(recorded.lessonIds).toContain(`development-lesson:${lessonId}`);
      expect(recorded.evidence.block).toBe(packed.block);
      expect((await db.select().from(codegraphEpisodes).where(eq(codegraphEpisodes.sourceId, id)))).toHaveLength(1);
    } finally {
      if (lessonId) await db.delete(codegraphLessons).where(eq(codegraphLessons.id, `development-lesson:${lessonId}`));
      await db.delete(codegraphQueries).where(eq(codegraphQueries.buildId, id));
      await db.delete(codegraphSnapshots).where(eq(codegraphSnapshots.buildId, id));
      await db.delete(codegraphEpisodes).where(eq(codegraphEpisodes.sourceId, id));
      await db.delete(codegraphNodes).where(eq(codegraphNodes.canonicalPath, file));
      await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id));
    }
  });

});
