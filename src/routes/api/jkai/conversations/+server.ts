import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultThinkingLevel } from '$lib/server/models/settings';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { modelSupportsThinking } from '$lib/server/models/capabilities';
import type { ModelContext } from '$lib/server/models/types';

export const GET: RequestHandler = async () => {
	const rows = await getConversationList();
	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { title, source, whatsappPhoneNumber, modelProvider, modelId } = body;

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
	const thinkingLevel = await resolveDefaultThinkingLevel();

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
		})
		.returning();

	// The composer needs to know whether to offer a thinking chip before the
	// thread has anything to load — a new thread is seeded from this response
	// rather than re-fetched, so an absent flag would hide the control on exactly
	// the threads where it is most likely to be set.
	return json({ ...conv, modelSupportsThinking: await modelSupportsThinking(ctx) }, { status: 201 });
};
