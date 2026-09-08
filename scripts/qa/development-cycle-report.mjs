/** Read-only local benchmark export. Compare matching brief keys across model choices. */
import pg from 'pg';
import { createHash } from 'node:crypto';
const connectionString = process.env.DATABASE_URL;
if (!/127\.0\.0\.1:15435\/jkai_local$/.test(connectionString ?? '')) throw new Error('Use the isolated JKAI local database.');
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('begin read only');
  const { rows } = await client.query(`select b.id,b.model_id,b.status,d.state from jkai_builds b join jkai_build_deliveries d on d.build_id=b.id order by b.created_at desc limit 100`);
  const report = rows.filter(r => r.state.cycle).map(row => {
    const { brief, criteria, cycle } = row.state;
    const briefKey = createHash('sha256').update(JSON.stringify([brief.outcome, brief.scope, brief.constraints, brief.routes, criteria.map(c => c.text)])).digest('hex').slice(0, 12);
    const seconds = end => end ? Math.round((Date.parse(end) - Date.parse(cycle.startedAt)) / 1000) : null;
    return { id: row.id, briefKey, model: cycle.modelId ?? row.model_id, startingCandidate: cycle.startingCandidate ?? null, status: row.status, firstPreviewSeconds: seconds(cycle.firstPreviewAt), candidateSeconds: seconds(cycle.candidateAt), modelSeconds: Math.round(cycle.modelMs / 1000), previewSeconds: Math.round(cycle.previewMs / 1000), verificationSeconds: Math.round(cycle.verificationMs / 1000), phaseSeconds: Object.fromEntries(Object.entries(cycle.phaseMs ?? {}).map(([phase, ms]) => [phase, Math.round(ms / 1000)])), blocker: cycle.failure ?? null };
  });
  console.log(JSON.stringify({ note: 'Compare the same brief key. Null means no measured milestone; synthetic runs do not establish model performance.', runs: report }, null, 2));
  await client.query('rollback');
} finally { await client.end(); }
