import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats, openrouterModels, jkaiAttachments, jkaiBuilds } from '$lib/db/schema';
import { eq, asc, sql, inArray, and, notInArray, desc } from 'drizzle-orm';
import { getModelCapabilities } from '$lib/server/models/capabilities';

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

	// Fetch attachments for all messages
	const messageIds = allMessages.map((m: any) => m.id).filter(Boolean);
	const attachmentsData = messageIds.length > 0
		? await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.messageId, messageIds))
		: [];
	const attachmentsByMsg = new Map<string, typeof attachmentsData>();
	for (const a of attachmentsData) {
		if (!a.messageId) continue;
		const arr = attachmentsByMsg.get(a.messageId) ?? [];
		arr.push(a);
		attachmentsByMsg.set(a.messageId, arr);
	}
	const messagesWithAttachments = allMessages.map((m: any) => ({
		...m,
		attachments: attachmentsByMsg.get(m.id) ?? [],
	}));

	// Get model capabilities from conversation's pinned model
	const modelCaps = getModelCapabilities({
		provider: conv.modelProvider as 'zai' | 'openrouter',
		modelId: conv.modelId,
	});

	const TERMINAL_BUILD_STATUSES = ['completed', 'failed'] as const;
	const [activeBuild] = await db
		.select({
			id: jkaiBuilds.id,
			title: jkaiBuilds.title,
			status: jkaiBuilds.status,
			createdAt: jkaiBuilds.createdAt,
			serveConfig: jkaiBuilds.serveConfig,
		})
		.from(jkaiBuilds)
		.where(and(
			eq(jkaiBuilds.conversationId, params.id),
			notInArray(jkaiBuilds.status, TERMINAL_BUILD_STATUSES as unknown as string[]),
		))
		.orderBy(desc(jkaiBuilds.createdAt))
		.limit(1);

	return json({
		conversation: conv,
		messages: messagesWithAttachments,
		modelCapabilities: modelCaps,
		activeBuild: activeBuild ?? null,
	});
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
