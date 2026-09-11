#!/usr/bin/env npx tsx
//
// Retire the `node` artefacts the policy graph stage used to emit.
//
// Stage 3 was asked for a `node` record per entity it touched, alongside its
// edges. Nothing in the application ever rendered one: every view — the network
// grid, the relationship list, the graph modal — derives its entities from EDGE
// ENDPOINTS, and no edge has ever pointed at a node record. Measured on the box
// at 2026-09-11: 754 node rows across five assessments, 48-69% of each one's
// stage-3 output, and zero of them an endpoint of anything.
//
// Their one consumer was `graphUncovered`, the guard that decides whether the
// twelve structural checks may reach a verdict — and there they did active harm,
// because nodes were emitted for mechanisms and claims as well as actors and the
// ratio was taken against the actor count alone. That guard now measures from
// edges, so the rows have no reader left at all.
//
// THE CITATIONS ARE REPOINTED, NOT DROPPED. 288 provenance rows cite a node —
// 235 from edges, 53 from profile fields — and deleting the rows underneath them
// would leave those citations dangling. Each is moved to the entity the node
// wrapped (`data.entityId`), which is what the citation meant in the first
// place, and deduplicated. Profile `data.<field>.refs` arrays carry the same ids
// inside jsonb and are rewritten the same way.
//
// PROSE IS LEFT ALONE. Two profile fields on the live data name a node id inside
// their written value ("s3_099_node_001 labels the same target as Nesta"), which
// is the model's own wording about a conflict it found. Rewriting a finding's
// sentence is editing the analysis; those ids are left stale, and they pointed at
// a wrapper a reader could learn nothing from either way.
//
// Safe to re-run: it finds nothing the second time. Dry run by default.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/retire-policy-graph-nodes.ts [--apply] [--backup <dir>]
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

const APPLY = process.argv.includes('--apply');
const backupAt = process.argv.indexOf('--backup');
const BACKUP_DIR = backupAt >= 0 ? process.argv[backupAt + 1] : null;

type Row = Record<string, unknown>;
const rowsOf = async (query: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(query)).rows as Row[];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  console.log(`target: ${url.replace(/^[^@]*@/, '').split('?')[0]}`);
  console.log(APPLY ? 'mode:   APPLY (writes)' : 'mode:   dry run (no writes)');

  const nodes = await rowsOf(sql`
    SELECT analysis_id, id, label, data ->> 'entityId' AS entity_id
    FROM policy_artefacts WHERE kind = 'node'`);
  if (!nodes.length) {
    console.log('\nNo node artefacts remain. Nothing to do.');
    return;
  }

  // A node whose entityId does not resolve cannot have its citations repointed.
  // It is still deleted — it was unreadable either way — but the count is
  // reported rather than buried, because a citation lost is a citation lost.
  const resolvable = await rowsOf(sql`
    SELECT n.analysis_id, n.id, n.data ->> 'entityId' AS entity_id
    FROM policy_artefacts n
    JOIN policy_artefacts e ON e.analysis_id = n.analysis_id AND e.id = n.data ->> 'entityId'
    WHERE n.kind = 'node'`);
  const target = new Map(resolvable.map((r) => [`${r.analysis_id}|${r.id}`, String(r.entity_id)]));
  const orphaned = nodes.filter((n) => !target.has(`${n.analysis_id}|${n.id}`));

  const citations = await rowsOf(sql`
    SELECT p.analysis_id, p.from_id, p.to_id, f.kind AS from_kind
    FROM policy_provenance p
    JOIN policy_artefacts n ON n.analysis_id = p.analysis_id AND n.id = p.to_id AND n.kind = 'node'
    JOIN policy_artefacts f ON f.analysis_id = p.analysis_id AND f.id = p.from_id`);
  const outgoing = await rowsOf(sql`
    SELECT count(*)::int AS n FROM policy_provenance p
    JOIN policy_artefacts x ON x.analysis_id = p.analysis_id AND x.id = p.from_id AND x.kind = 'node'`);
  const profiles = await rowsOf(sql`
    SELECT a.analysis_id, a.id, a.data
    FROM policy_artefacts a
    WHERE a.kind = 'profile' AND EXISTS (
      SELECT 1 FROM policy_artefacts n
      WHERE n.analysis_id = a.analysis_id AND n.kind = 'node' AND a.data::text LIKE '%' || n.id || '%')`);

  const byKind = citations.reduce<Record<string, number>>((acc, c) => {
    acc[String(c.from_kind)] = (acc[String(c.from_kind)] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${nodes.length} node artefacts across ${new Set(nodes.map((n) => n.analysis_id)).size} assessments`);
  console.log(`  ${citations.length} provenance citations TO a node (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}) — repointed`);
  console.log(`  ${Number(outgoing[0]?.n ?? 0)} provenance rows FROM a node — deleted with it`);
  console.log(`  ${profiles.length} profiles carrying a node id inside data.refs — rewritten`);
  if (orphaned.length) console.log(`  ${orphaned.length} nodes whose entityId does not resolve — citations to them cannot be repointed`);

  if (BACKUP_DIR) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dump = { takenAt: stamp, nodes, citations, profiles };
    const path = `${BACKUP_DIR}/policy-node-retirement-${stamp}.json`;
    writeFileSync(path, JSON.stringify(dump, null, 2));
    console.log(`\nbackup: ${path}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  await db.transaction(async (tx) => {
    // 1. Repoint every citation of a node at the entity that node wrapped.
    //    ON CONFLICT DO NOTHING because the citer very often already cites the
    //    entity directly — an edge naming both its endpoint and the endpoint's
    //    node record is the common case.
    await tx.execute(sql`
      INSERT INTO policy_provenance (analysis_id, from_id, to_id)
      SELECT DISTINCT p.analysis_id, p.from_id, n.data ->> 'entityId'
      FROM policy_provenance p
      JOIN policy_artefacts n ON n.analysis_id = p.analysis_id AND n.id = p.to_id AND n.kind = 'node'
      JOIN policy_artefacts t ON t.analysis_id = p.analysis_id AND t.id = n.data ->> 'entityId'
      WHERE p.from_id <> n.data ->> 'entityId'
      ON CONFLICT DO NOTHING`);

    // 2. Rewrite the node ids that live inside profile field `refs` arrays.
    for (const profile of profiles) {
      const analysisId = String(profile.analysis_id);
      const map = new Map(
        nodes.filter((n) => n.analysis_id === analysisId).map((n) => [String(n.id), n.entity_id ? String(n.entity_id) : null]),
      );
      const data = profile.data as Record<string, unknown>;
      let touched = false;
      for (const value of Object.values(data)) {
        if (!value || typeof value !== 'object' || !('refs' in value)) continue;
        const field = value as { refs: unknown };
        if (!Array.isArray(field.refs)) continue;
        const next = [...new Set(field.refs.map((r) => (map.has(String(r)) ? map.get(String(r)) : String(r))).filter((r): r is string => Boolean(r)))];
        if (next.length !== field.refs.length || next.some((r, i) => r !== field.refs[i])) touched = true;
        field.refs = next;
      }
      if (touched) {
        await tx.execute(sql`UPDATE policy_artefacts SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
                             WHERE analysis_id = ${analysisId} AND id = ${String(profile.id)}`);
      }
    }

    // 3. Drop the provenance rows on both sides, then the nodes themselves.
    await tx.execute(sql`
      DELETE FROM policy_provenance p USING policy_artefacts n
      WHERE n.analysis_id = p.analysis_id AND n.kind = 'node' AND (n.id = p.to_id OR n.id = p.from_id)`);
    await tx.execute(sql`DELETE FROM policy_artefacts WHERE kind = 'node'`);
  });

  const [left] = await rowsOf(sql`SELECT count(*)::int AS n FROM policy_artefacts WHERE kind = 'node'`);
  const [dangling] = await rowsOf(sql`
    SELECT count(*)::int AS n FROM policy_provenance p
    WHERE NOT EXISTS (SELECT 1 FROM policy_artefacts a WHERE a.analysis_id = p.analysis_id AND a.id = p.to_id)`);
  console.log(`\ndone. node artefacts remaining: ${left?.n ?? '?'} · provenance rows pointing at nothing: ${dangling?.n ?? '?'}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
