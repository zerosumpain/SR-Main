/** Read-only deployment guard: leave an active development worker untouched. */
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const deadline = Date.now() + 300000;
  while (true) {
    const { rows } = await client.query(`select count(*)::int as active from jkai_builds b join jkai_build_deliveries d on d.build_id=b.id where b.status in ('running','queued') or d.state->'preview'->>'status'='starting' or d.state->>'stage'='integrating'`);
    if (!rows[0].active) { console.log('Development runtime idle: no active build or preview operation.'); break; }
    if (Date.now() >= deadline) throw new Error('Development is still active; broker was not restarted. Retry deployment after the build pauses.');
    console.log(`Waiting for ${rows[0].active} active development operation(s) before broker replacement.`);
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
} finally { await client.end(); }
