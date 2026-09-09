import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphSnapshots, codegraphNodes, codegraphEdges, codegraphLessons, codegraphAssessments } from '$lib/db/schema';
import { familyOf } from './family';
import type { StructuralSnapshot } from './snapshot';

/** Validate completeness before changing any live relationships. */
export function validateSnapshot(value: unknown): asserts value is StructuralSnapshot {
  const s = value as StructuralSnapshot;
  if (!s || s.version !== 1 || !/^[a-f0-9]{40,64}$/.test(s.revision) || !s.repo || s.repo.length > 200 || !s.complete ||
    !Array.isArray(s.files) || s.files.length > 30000 || s.fileCount !== s.files.length || new Set(s.files).size !== s.files.length ||
    s.files.some(p => typeof p !== 'string' || p.startsWith('/') || p.split('/').includes('..') || p.length > 1000) ||
    !Array.isArray(s.edges) || s.edges.length > 100000 || !Array.isArray(s.routes) || !Array.isArray(s.dependencies) || !Array.isArray(s.unresolved) || !s.hashes) throw new Error('Invalid or incomplete structural snapshot');
  const hash = createHash('sha256').update([...s.files].sort().join('\n')).digest('hex');
  const files = new Set(s.files);
  if (hash !== s.manifestHash || s.files.some(p => !/^[a-f0-9]{40,64}$/.test(s.hashes[p] ?? '')) ||
    s.edges.some(e => !['imports', 'tests', 'references'].includes(e.kind) || !files.has(e.source) || !files.has(e.target))) throw new Error('Snapshot manifest or edges do not match its files');
}
export async function saveSnapshot(snapshot: StructuralSnapshot, scope: 'deployed' | 'candidate' | 'batch' | 'owned', buildId?: string, baseline?: string) {
  validateSnapshot(snapshot);
  // An improved parser or semantic index can enrich the same commit without rewriting old evidence.
  const indexHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const id = createHash('sha256').update([snapshot.repo, scope, buildId ?? '', snapshot.revision, baseline ?? '', indexHash].join(':')).digest('hex');
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`codegraph:${snapshot.repo}:${scope}`}))`);
    const [previous] = await tx.select().from(codegraphSnapshots).where(and(eq(codegraphSnapshots.repo, snapshot.repo), eq(codegraphSnapshots.scope, scope), eq(codegraphSnapshots.active, true), buildId ? eq(codegraphSnapshots.buildId, buildId) : isNull(codegraphSnapshots.buildId))).limit(1);
    await tx.update(codegraphSnapshots).set({ active: false }).where(and(eq(codegraphSnapshots.repo, snapshot.repo), eq(codegraphSnapshots.scope, scope), buildId ? eq(codegraphSnapshots.buildId, buildId) : isNull(codegraphSnapshots.buildId)));
    await tx.insert(codegraphSnapshots).values({ active: true, id, repo: snapshot.repo, revision: snapshot.revision, scope, buildId, baseline, payload: snapshot as unknown as Record<string, unknown> }).onConflictDoUpdate({ target: codegraphSnapshots.id, set: { active: true } });
    // Only deployed/owned snapshots are eligible for shared graph liveness.
    if (!['deployed', 'owned'].includes(scope)) return;
    if (previous && previous.revision !== snapshot.revision) {
      const old = previous.payload as unknown as StructuralSnapshot;
      const lessons = await tx.select().from(codegraphLessons).where(and(eq(codegraphLessons.repo, snapshot.repo), isNull(codegraphLessons.retiredAt))).limit(2000);
      for (const lesson of lessons) {
        const changed = lesson.citedPaths.filter(p => old.hashes[p] !== snapshot.hashes[p]);
        if (!changed.length) continue;
        await tx.insert(codegraphAssessments).values({ id: `revalidate:${id}:${lesson.id}`, targetId: lesson.id, verdict: 'revalidate', revision: snapshot.revision,
          evidence: `Cited implementation changed: ${changed.slice(0, 5).join(', ')}. Recheck the lesson against this revision; change alone does not disprove it.` }).onConflictDoNothing();
      }
    }
    await tx.update(codegraphNodes).set({ existsOnHead: false }).where(and(eq(codegraphNodes.repo, snapshot.repo), eq(codegraphNodes.kind, 'file')));
    for (let i = 0; i < snapshot.files.length; i += 500) {
      await tx.insert(codegraphNodes).values(snapshot.files.slice(i, i + 500).map(path => ({ repo: snapshot.repo, canonicalPath: path, kind: 'file',
        displayName: path.split('/').pop()!, existsOnHead: true, family: familyOf(path), lastSeenAt: new Date() })))
        .onConflictDoUpdate({ target: [codegraphNodes.repo, codegraphNodes.canonicalPath], set: { existsOnHead: true, lastSeenAt: new Date() } });
    }
    const nodes = await tx.select({ id: codegraphNodes.id, path: codegraphNodes.canonicalPath }).from(codegraphNodes).where(eq(codegraphNodes.repo, snapshot.repo));
    const ids = new Map(nodes.map(n => [n.path, n.id]));
    await tx.delete(codegraphEdges).where(and(inArray(codegraphEdges.kind, ['imports', 'tests', 'references']),
      sql`${codegraphEdges.sourceId} IN (SELECT id FROM codegraph_nodes WHERE repo = ${snapshot.repo})`));
    const edges = [...new Map(snapshot.edges.map(e => [[e.source, e.target, e.kind].join(':'), e])).values()];
    for (let i = 0; i < edges.length; i += 500) {
      await tx.insert(codegraphEdges).values(edges.slice(i, i + 500).map(e => ({ sourceId: ids.get(e.source)!, targetId: ids.get(e.target)!, kind: e.kind, weight: 1, lastSeenAt: new Date() }))).onConflictDoNothing();
    }
    await tx.execute(sql`UPDATE codegraph_nodes n SET degree = (SELECT count(*) FROM codegraph_edges e WHERE e.suppressed = false AND (e.source_id = n.id OR e.target_id = n.id)) WHERE n.repo = ${snapshot.repo}`);
  });
  return id;
}
