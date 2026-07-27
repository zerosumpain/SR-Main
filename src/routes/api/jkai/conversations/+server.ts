import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { ModelContext } from '$lib/server/models/types';

export const GET: RequestHandler = async () => {
	const rows = await getConversationList();
	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { title, source, whatsappPhoneNumber, modelProvider, modelId } = body;

	// Resolve model: body override > admin chat default
	let ctx: ModelContext;
	if (modelProvider && modelId) {
		ctx = { provider: modelProvider, modelId };
	} else {
		ctx = await resolveDefaultModel();
	}

	const priceSnapshot = await snapshotPrice(ctx);

	const [conv] = await db
		.insert(conversations)
		.values({
			title: title || null,
			source: source || 'web',
			whatsappPhoneNumber: whatsappPhoneNumber || null,
			modelProvider: ctx.provider,
			modelId: ctx.modelId,
			priceSnapshot,
		})
		.returning();

	return json(conv, { status: 201 });
};
