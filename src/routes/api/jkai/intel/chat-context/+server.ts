import { json, error } from '@sveltejs/kit';
import { hasJkaiServiceToken } from '$lib/server/invoke-auth';
import type { RequestHandler } from './$types';

/**
 * The intel context a chat turn needs, in one call.
 *
 * Two reads, one endpoint, deliberately. `buildKnowledgeContext` and
 * `buildEntityGrounding` both run on the same turn assembling the same prompt,
 * and both sit on its critical path — so the chat application pays one round
 * trip rather than two. Same shape as Main asking Health for
 * `GET /api/health/context` in a single call rather than per-series.
 *
 * POST rather than GET because the user message is the argument and a chat
 * message runs to 20,000 characters; that does not belong in a query string.
 *
 * Both fields are optional and independent: a turn with no entity mentions asks
 * for knowledge alone and gets `grounding: ''`, which is what the in-process
 * caller already does with an empty id list.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();
	if (!hasJkaiServiceToken(request) && !session?.user) throw error(401, 'Unauthorized');

	const body = (await request.json().catch(() => null)) as
		| { userMessage?: unknown; entityIds?: unknown }
		| null;
	if (!body) throw error(400, 'body must be JSON');

	const userMessage = typeof body.userMessage === 'string' ? body.userMessage : '';
	const entityIds = Array.isArray(body.entityIds)
		? body.entityIds.filter((id): id is string => typeof id === 'string')
		: [];

	// Loaded on demand: `context.ts` reaches the graph analysis and the note
	// store, and this route must not put either on the static graph of anything
	// that merely imports the app's route tree.
	const { buildKnowledgeContext, buildEntityGrounding } = await import('$lib/jkai/intel/context');

	// Run together — they share a turn's latency budget and neither needs the
	// other's answer.
	const [knowledge, grounding] = await Promise.all([
		userMessage ? buildKnowledgeContext(userMessage) : Promise.resolve(''),
		entityIds.length ? buildEntityGrounding(entityIds) : Promise.resolve(''),
	]);

	return json({ knowledge, grounding });
};
