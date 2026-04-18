import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats, openrouterModels } from '$lib/db/schema';
import { eq, asc, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, params.id))
		.limit(1);

	if (!conv) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	// Load web messages
	const webMessages = await db
		.select({
			id: orchestratorChats.id,
			role: orchestratorChats.role,
			content: orchestratorChats.content,
			metadata: orchestratorChats.metadata,
			createdAt: orchestratorChats.createdAt,
		})
		.from(orchestratorChats)
		.where(eq(orchestratorChats.conversationId, params.id))
		.orderBy(asc(orchestratorChats.createdAt));

	// All messages (including migrated WhatsApp) are now in orchestrator_chats
	const allMessages = webMessages.map((m) => ({
		...m,
		source: conv.source === 'whatsapp' ? ('whatsapp' as const) : ('web' as const),
	}));

	return json({ conversation: conv, messages: allMessages });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await db.delete(conversations).where(eq(conversations.id, params.id));
	return json({ deleted: true });
};

/**
 * PATCH: change the pinned model on a conversation BEFORE any message has been sent.
 * Body: { modelProvider: 'zai' | 'openrouter', modelId: string }
 * 403 if any messages exist on the conversation (locked after first message).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { modelProvider, modelId } = body;

	if (modelProvider !== 'zai' && modelProvider !== 'openrouter') {
		throw error(400, 'modelProvider must be zai or openrouter');
	}
	if (typeof modelId !== 'string' || modelId.length === 0) {
		throw error(400, 'modelId is required');
	}

	// Load the conversation.
	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, params.id))
		.limit(1);
	if (!conv) throw error(404, 'conversation not found');

	// Lock if any message exists (web orchestrator chat OR, for continuations, a WA row).
	const [{ cnt }] = await db
		.select({ cnt: sql<number>`count(*)::int` })
		.from(orchestratorChats)
		.where(eq(orchestratorChats.conversationId, params.id));
	if (cnt > 0) throw error(409, 'model is locked after the first message');

	// Re-snapshot the price if switching to an OpenRouter model.
	let priceSnapshot: { promptPrice: number; completionPrice: number } | null = null;
	if (modelProvider === 'openrouter') {
		const [row] = await db
			.select()
			.from(openrouterModels)
			.where(eq(openrouterModels.id, modelId))
			.limit(1);
		if (row) {
			priceSnapshot = {
				promptPrice: Number(row.promptPrice ?? 0),
				completionPrice: Number(row.completionPrice ?? 0),
			};
		}
	}

	const [updated] = await db
		.update(conversations)
		.set({ modelProvider, modelId, priceSnapshot })
		.where(eq(conversations.id, params.id))
		.returning();

	return json(updated);
};
