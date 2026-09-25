import { json, error } from '@sveltejs/kit';
import { hasJkaiServiceToken } from '$lib/server/invoke-auth';
import { isOwnerScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import type { RequestHandler } from './$types';

/**
 * Extract a conversation's concepts into intel.
 *
 * The chat endpoint calls this at the end of a turn and does not wait:
 * `void maybeExtractThreadConcepts(id, null).catch(() => {})`. **That property
 * has to survive the boundary.** A turn must not fail, slow down or report an
 * error because the extraction did — so the caller fires and forgets, and this
 * answers 202 with whatever the extractor said rather than turning a failed
 * extraction into a failed request.
 *
 * There is a test in SR-Main asserting the in-process call exists at all,
 * because "imported but never called" is not something the type checker or the
 * gate sees — the same hazard applies here, one hop further away.
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const session = await locals.auth();
	if (!hasJkaiServiceToken(request) && !session?.user) throw error(401, 'Unauthorized');
	// Chat extraction writes notes into the OWNER's space (it takes no scope:
	// chat threads are the owner's). Until it does, only the owner's scope may
	// trigger it, or a member's thread would land in the owner's graph.
	if (!isOwnerScope(await resolveRequestScope(event))) throw error(403, 'owner only');

	const body = (await request.json().catch(() => null)) as
		| { conversationId?: unknown; title?: unknown; force?: unknown }
		| null;
	if (!body || typeof body.conversationId !== 'string' || !body.conversationId) {
		throw error(400, 'conversationId required');
	}
	const title = typeof body.title === 'string' ? body.title : null;

	const { maybeExtractThreadConcepts } = await import('$lib/jkai/intel/chat-extract');
	try {
		const outcome = await maybeExtractThreadConcepts(body.conversationId, title, {
			force: body.force === true,
		});
		return json({ ok: true, outcome: outcome ?? null }, { status: 202 });
	} catch (e) {
		// Reported, never thrown: the caller is a chat turn that has already
		// answered the user.
		return json(
			{ ok: false, error: e instanceof Error ? e.message : 'extraction failed' },
			{ status: 202 },
		);
	}
};
