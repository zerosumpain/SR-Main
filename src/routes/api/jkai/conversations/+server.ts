import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { getConversationList, searchConversationList } from '$lib/jkai/queries';
import { resolveDefaultThinkingLevel } from '$lib/server/models/settings';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { modelSupportsThinking } from '$lib/server/models/capabilities';
import type { ModelContext } from '$lib/server/models/types';
import { chatAccess, conversationListScope } from '$lib/jkai/chat-access.server';

export const GET: RequestHandler = async (event) => {
	const { url } = event;
	// The owner's hub lists the owner's own threads, as it always has; a member
	// lists what they may read.
	const scope = conversationListScope(await chatAccess(event));
	const limit = Number(url.searchParams.get('limit') ?? undefined);
	// A search reaches the whole archive and answers in one un-paged set, so it
	// short-circuits the cursor path entirely: a cursor describes a position in
	// the recency ordering, which the relevance ordering does not share.
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q) {
		return json(await searchConversationList({ q, limit: Number.isFinite(limit) ? limit : undefined, scope }));
	}
	const beforeRaw = url.searchParams.get('before');
	const beforeId = url.searchParams.get('beforeId');
	const pinnedRaw = url.searchParams.get('beforePinned');
	const before = beforeRaw ? new Date(beforeRaw) : null;
	const cursorRequested = beforeRaw !== null || beforeId !== null || pinnedRaw !== null;
	if (
		cursorRequested &&
		(!before || Number.isNaN(before.getTime()) || !beforeId || (pinnedRaw !== '0' && pinnedRaw !== '1'))
	) {
		return json({ error: 'Invalid conversation cursor' }, { status: 400 });
	}
	const page = await getConversationList({
		limit: Number.isFinite(limit) ? limit : undefined,
		cursor: before && beforeId && pinnedRaw
			? { before, beforeId, pinned: pinnedRaw === '1' }
			: undefined,
		scope,
	});
	return json(page);
};

export const POST: RequestHandler = async (event) => {
	const { request } = event;
	const access = await chatAccess(event);
	const isOwner = access.level === 'owner';
	const body = await request.json();
	const { title } = body;
	// A member's thread is a plain web thread on the site's chat model: no model
	// pick (the owner's spend), no WhatsApp binding (the owner's number), and
	// no thinking level (the owner's last pick).
	const source = isOwner ? body.source : 'web';
	const whatsappPhoneNumber = isOwner ? body.whatsappPhoneNumber : null;
	const modelProvider = isOwner ? body.modelProvider : undefined;
	const modelId = isOwner ? body.modelId : undefined;

	// Resolve model: body override > the `chat` workload (which itself follows
	// the site default until pinned — see $lib/models/workloads).
	//
	// Which of the two it was is recorded, not just the result. A body override
	// is the composer's picker — a deliberate choice that the rest of the session
	// should follow. The default branch stamps whatever the site default is right
	// now, which is not a choice about anything and must not propagate.
	let ctx: ModelContext;
	let pinnedByUser = false;
	if (modelProvider && modelId) {
		ctx = { provider: modelProvider, modelId };
		pinnedByUser = true;
	} else {
		ctx = await resolveChatTurnModel();
	}

	const priceSnapshot = await snapshotPrice(ctx);
	// A new thread opens on the thinking level last chosen anywhere in chat —
	// the "default" is simply the last pick, not a separate setting to maintain.
	// Null when nothing has been chosen yet, which sends no reasoning field at
	// all and leaves the provider's own default in charge.
	const thinkingLevel = isOwner ? await resolveDefaultThinkingLevel() : null;

	const [conv] = await db
		.insert(conversations)
		.values({
			title: title || null,
			source: source || 'web',
			whatsappPhoneNumber: whatsappPhoneNumber || null,
			modelProvider: ctx.provider,
			modelId: ctx.modelId,
			modelPinnedByUser: pinnedByUser,
			thinkingLevel,
			priceSnapshot,
			principalId: access.own,
		})
		.returning();

	// The composer needs to know whether to offer a thinking chip before the
	// thread has anything to load — a new thread is seeded from this response
	// rather than re-fetched, so an absent flag would hide the control on exactly
	// the threads where it is most likely to be set.
	return json({ ...conv, modelSupportsThinking: await modelSupportsThinking(ctx) }, { status: 201 });
};
