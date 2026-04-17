import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, openrouterModels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultModel } from '$lib/server/models/settings';
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
		ctx = await resolveDefaultModel('chat');
	}

	// Snapshot price if OpenRouter
	let priceSnapshot: { promptPrice: number; completionPrice: number } | null = null;
	if (ctx.provider === 'openrouter') {
		const [row] = await db
			.select()
			.from(openrouterModels)
			.where(eq(openrouterModels.id, ctx.modelId))
			.limit(1);
		if (row) {
			priceSnapshot = {
				promptPrice: Number(row.promptPrice ?? 0),
				completionPrice: Number(row.completionPrice ?? 0),
			};
		}
	}

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
