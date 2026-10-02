// Backfill `jkai_build_lessons` into `codegraph_lessons` — one lessons store.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/backfill-build-lessons.ts [--apply]
//
// Dry run unless `--apply` is passed. Run it once per environment AFTER the
// release that stops writing `jkai_build_lessons`, and before a later release
// drops that table.
//
// IDEMPOTENT. Each legacy row keeps the identity the old read-time sync gave
// its copy, `development-lesson:<id>`, and the insert does nothing on a
// conflict — so a row already copied is left exactly as it is (counters,
// staleness and any tombstone included), and a second run inserts nothing.
// Every legacy row is carried over, not only those the sync had reached:
// the area list showed them all, and `areaLessons` keeps the 90-day window
// the old `expires_at` gave them (observedAt = the row's created_at).
//
// Writes nothing else: no delete from the legacy table, no schema change.
import { pathToFileURL } from 'node:url';
import { buildLessonRow } from '../src/lib/codegraph/build-lessons';

/** The two calls this needs from a `pg` client or pool. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface BackfillReport { scanned: number; inserted: number; existing: number; linked: number; apply: boolean }

const LEGACY = `SELECT l.id, l.build_id, l.lesson, l.evidence, l.revision, l.created_at,
  COALESCE(d.state->'changes'->'files', '[]'::jsonb) AS files
  FROM jkai_build_lessons l LEFT JOIN jkai_build_deliveries d ON d.build_id = l.build_id
  ORDER BY l.id`;

export async function backfillBuildLessons(db: Queryable, opts: { apply: boolean }): Promise<BackfillReport> {
  const { rows } = await db.query(LEGACY);
  const report: BackfillReport = { scanned: rows.length, inserted: 0, existing: 0, linked: 0, apply: opts.apply };
  for (const legacy of rows) {
    const files = Array.isArray(legacy.files) ? legacy.files.filter((f): f is string => typeof f === 'string') : [];
    const row = buildLessonRow({
      key: Number(legacy.id), buildId: String(legacy.build_id), lesson: String(legacy.lesson), evidence: String(legacy.evidence),
      revision: String(legacy.revision), files, at: new Date(legacy.created_at as string | Date),
    });
    if (!opts.apply) {
      const { rows: found } = await db.query('SELECT 1 FROM codegraph_lessons WHERE id = $1', [row.id]);
      if (found.length) report.existing += 1; else report.inserted += 1;
      continue;
    }
    const { rows: inserted } = await db.query(
      `INSERT INTO codegraph_lessons (id, repo, slug, title, body, origin, origin_ref, cited_paths, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) ON CONFLICT DO NOTHING RETURNING id`,
      [row.id, row.repo, row.slug, row.title, row.body, row.origin, row.originRef, JSON.stringify(row.citedPaths), row.observedAt],
    );
    if (!inserted.length) { report.existing += 1; continue; }
    report.inserted += 1;
    if (!row.citedPaths.length) continue;
    const { rows: links } = await db.query(
      `INSERT INTO codegraph_node_lessons (node_id, lesson_id)
       SELECT n.id, $1 FROM codegraph_nodes n WHERE n.repo = 'SR-Main' AND n.canonical_path = ANY($2::text[])
       ON CONFLICT DO NOTHING RETURNING node_id`,
      [row.id, row.citedPaths],
    );
    report.linked += links.length;
  }
  return report;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('set DATABASE_URL');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const report = await backfillBuildLessons(pool, { apply: process.argv.includes('--apply') });
    console.log(`${report.apply ? 'Applied' : 'Dry run'}: ${report.scanned} legacy lesson(s); ${report.inserted} ${report.apply ? 'inserted' : 'to insert'}, ${report.existing} already in the graph, ${report.linked} node link(s).`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
