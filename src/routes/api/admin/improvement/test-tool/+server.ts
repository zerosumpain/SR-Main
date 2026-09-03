import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DatastoreError, getRecordByKey, upsertRecord } from '$lib/datastore';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { runLiveToolTest } from '$lib/selfimprove/deployment';
import { COLLECTIONS, asData, type ToolAttemptData } from '$lib/selfimprove/types';

// Owner-only via hooks.server.ts. This deliberately calls the shared registry,
// not a private copy of the generated handler: the point is to prove the code
// currently deployed in the same execution path JKAI uses.
const OWNER = 'owner';
const MAX_ARGS_CHARS = 20_000;
const MAX_TEST_HISTORY = 20;

interface TestBody {
  attemptKey?: unknown;
  name?: unknown;
  args?: unknown;
}

/** POST { attemptKey, name, args } — bounded live acceptance test. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as TestBody;
  const attemptKey = typeof body.attemptKey === 'string' ? body.attemptKey.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const args = body.args;

  if (!attemptKey || !name) {
    return json({ error: '`attemptKey` and `name` are required' }, { status: 400 });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return json({ error: '`args` must be a JSON object' }, { status: 400 });
  }
  if (JSON.stringify(args).length > MAX_ARGS_CHARS) {
    return json({ error: `\`args\` must be smaller than ${MAX_ARGS_CHARS} characters` }, { status: 413 });
  }

  let attempt: ToolAttemptData;
  try {
    const record = await getRecordByKey(COLLECTIONS.toolAttempts, attemptKey, OWNER);
    attempt = record.data as unknown as ToolAttemptData;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') {
      return json({ error: `No self-improvement deployment "${attemptKey}".` }, { status: 404 });
    }
    throw err;
  }

  if (attempt.name !== name || attempt.status !== 'created' || attempt.shipped === false) {
    return json({ error: 'The requested attempt is not a deployed version of this tool.' }, { status: 409 });
  }

  const [tool] = await db
    .select({ name: customTools.name, enabled: customTools.enabled })
    .from(customTools)
    .where(eq(customTools.name, name))
    .limit(1);
  if (!tool) return json({ error: `The deployed tool "${name}" no longer exists.` }, { status: 404 });
  if (!tool.enabled) return json({ error: `The deployed tool "${name}" is disabled.` }, { status: 409 });

  const execution = await runLiveToolTest(args as Record<string, unknown>, (testArgs) =>
    executeTool(name, testArgs),
  );

  let recorded = true;
  try {
    const liveTests = [...(attempt.liveTests ?? []), execution.test].slice(-MAX_TEST_HISTORY);
    await upsertRecord(
      COLLECTIONS.toolAttempts,
      { key: attemptKey, data: asData({ ...attempt, liveTests }) },
      OWNER,
    );
  } catch (err) {
    recorded = false;
    console.error('[selfimprove] could not persist live tool test:', err);
  }

  return json({
    ok: execution.result.success,
    data: execution.result.data,
    error: execution.result.error,
    test: execution.test,
    recorded,
  });
};
