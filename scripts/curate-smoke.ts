/**
 * Manual smoke test for Plan B1: provision a session, verify the dev server
 * comes up on its allocated port, then tear it all down.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/curate-smoke.ts
 *
 * DATABASE_URL must be set in the environment. Source .env first if needed:
 *   set -a && source .env && set +a
 *   npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/curate-smoke.ts
 */
import { createCuratedSession, endCuratedSession } from '../src/lib/curate/session-lifecycle';

async function main() {
  const sessionId = `smoke-${Date.now()}`;
  console.log(`[smoke] creating session ${sessionId}…`);
  const created = await createCuratedSession({
    sessionId,
    targetType: 'smoke-test',
  });
  console.log(`[smoke] session up:`, created);

  console.log(`[smoke] curl http://localhost:${created.port}/ …`);
  const res = await fetch(`http://localhost:${created.port}/`);
  console.log(`[smoke] HTTP ${res.status}`);
  if (res.status >= 500) {
    console.error('[smoke] dev server returned 5xx — abort');
    process.exit(1);
  }

  console.log(`[smoke] ending session…`);
  await endCuratedSession(sessionId);
  console.log(`[smoke] done.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
