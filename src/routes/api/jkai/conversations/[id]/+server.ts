import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats, jkaiAttachments, jkaiBuilds, openrouterModels } from '$lib/db/schema';
import { eq, asc, sql, inArray, and, notInArray, desc } from 'drizzle-orm';
import { getModelCapabilities } from '$lib/server/models/capabilities';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { coerceModelContext } from '$lib/constants/default-models';

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

	// Get model capabilities from conversation's pinned model. Legacy rows can
	// still carry provider 'zai' + a bare GLM id — coerce to an OpenRouter
	// context so old conversations render (and price) as openrouter.
	const pinnedModel = coerceModelContext({ provider: conv.modelProvider, modelId: conv.modelId });
	const modelCaps = getModelCapabilities(pinnedModel);

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

	// Context window of the pinned model — the header strip renders the last
	// turn's prompt size against it as `N CTX %`. Null when the catalogue has no
	// row for the model (self-hosted / just-added ids), and the chunk is dropped.
	const [catalogue] = await db
		.select({
			contextLength: openrouterModels.contextLength,
			promptPrice: openrouterModels.promptPrice,
			completionPrice: openrouterModels.completionPrice,
		})
		.from(openrouterModels)
		.where(eq(openrouterModels.id, pinnedModel.modelId))
		.limit(1);

	// Live prices for the composer's `est. £/turn` chip. `conversations.price_snapshot`
	// is only written when the model is switched before the first message, so most
	// threads have none — fall back to the catalogue's current rate rather than
	// hiding the estimate.
	const priceSnapshot =
		(conv.priceSnapshot as { promptPrice: number; completionPrice: number } | null) ??
		(catalogue?.promptPrice != null && catalogue?.completionPrice != null
			? {
					promptPrice: Number(catalogue.promptPrice),
					completionPrice: Number(catalogue.completionPrice),
				}
			: null);

	return json({
		conversation: {
			...conv,
			modelProvider: pinnedModel.provider,
			modelId: pinnedModel.modelId,
			priceSnapshot,
		},
		messages: messagesWithAttachments,
		modelCapabilities: modelCaps,
		modelContextLength: catalogue?.contextLength ?? null,
		activeBuild: activeBuild ?? null,
	});
};

export const DELETE: RequestHandler = async ({ params }) => {
	await db.delete(conversations).where(eq(conversations.id, params.id));
	return json({ deleted: true });
};

/**
 * PATCH: change the pinned model on a conversation BEFORE any message has been sent.
 * Body: { modelProvider: 'openrouter', modelId: string }
 * 403 if any messages exist on the conversation (locked after first message).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();

	// Rename / pin / share — allowed at any time (unlike the model change,
	// these are not locked after the first message).
	if ('title' in body || 'pinned' in body || 'shareVisibility' in body) {
		const set: Partial<{ title: string | null; pinned: boolean; shareVisibility: string; shareToken: string }> = {};
		if ('title' in body) {
			const t = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
			set.title = t.length > 0 ? t : null;
		}
		if ('pinned' in body) set.pinned = !!body.pinned;
		if ('shareVisibility' in body) {
			const vis = body.shareVisibility;
			if (vis !== 'private' && vis !== 'users' && vis !== 'public') {
				throw error(400, 'shareVisibility must be private, users, or public');
			}
			set.shareVisibility = vis;
			// Mint the share token the first time a conversation is shared; keep
			// it on unshare so re-sharing reuses the same link.
			if (vis !== 'private') {
				const [existing] = await db
					.select({ shareToken: conversations.shareToken })
					.from(conversations)
					.where(eq(conversations.id, params.id))
					.limit(1);
				if (!existing) throw error(404, 'conversation not found');
				if (!existing.shareToken) {
					const { randomBytes } = await import('node:crypto');
					set.shareToken = randomBytes(18).toString('base64url');
				}
			}
		}
		const [updated] = await db
			.update(conversations)
			.set(set)
			.where(eq(conversations.id, params.id))
			.returning();
		if (!updated) throw error(404, 'conversation not found');
		return json(updated);
	}

	const { modelProvider, modelId } = body;

	if (modelProvider !== 'openrouter') {
		throw error(400, 'modelProvider must be openrouter');
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

	const priceSnapshot = await snapshotPrice({ provider: modelProvider, modelId });

	const [updated] = await db
		.update(conversations)
		.set({ modelProvider, modelId, priceSnapshot })
		.where(eq(conversations.id, params.id))
		.returning();

	return json(updated);
};
