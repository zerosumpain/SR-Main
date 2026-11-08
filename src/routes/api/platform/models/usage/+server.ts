import { json, error } from '@sveltejs/kit';
import { modelServiceAppFor } from '$lib/server/model-service-auth';
import { ingestUsageEvents } from '$lib/costs/usage-ingest.server';
import { MAX_USAGE_BATCH } from '$lib/llm/model-service-contract';
import type { RequestHandler } from './$types';

/**
 * LLM usage from the extracted applications, into the cost ledger.
 *
 * Each event becomes the `agent_actions` row `$lib/llm/usage-log` would have
 * written had the call been made here, keyed by the sender's event id so a
 * retried batch is a no-op. The application is taken from the credential, never
 * from the body. A malformed event is reported back and skipped; the rest of
 * the batch still lands.
 */
export const POST: RequestHandler = async ({ request }) => {
	const app = modelServiceAppFor(request);
	if (!app) throw error(401, 'invalid token');
	const body = (await request.json().catch(() => null)) as { events?: unknown } | null;
	if (!body || !Array.isArray(body.events)) throw error(400, 'expected { events: [...] }');
	if (body.events.length > MAX_USAGE_BATCH) throw error(400, `at most ${MAX_USAGE_BATCH} events per call`);
	return json(await ingestUsageEvents(app, body.events));
};
