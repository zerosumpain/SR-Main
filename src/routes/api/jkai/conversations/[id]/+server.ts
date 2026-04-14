import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats, whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

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

	// If WhatsApp continuation, also load WhatsApp messages
	let whatsappMessages: Array<{
		id: string;
		role: string;
		content: string;
		metadata: unknown;
		createdAt: Date;
		source: 'whatsapp';
	}> = [];

	if (conv.whatsappPhoneNumber) {
		const waRows = await db
			.select()
			.from(whatsappConversations)
			.where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
			.orderBy(asc(whatsappConversations.createdAt));

		whatsappMessages = waRows.map((r) => ({
			id: r.id,
			role: r.role,
			content: r.content,
			metadata: r.metadata,
			createdAt: r.createdAt,
			source: 'whatsapp' as const,
		}));
	}

	// Merge chronologically
	const allMessages = [
		...whatsappMessages,
		...webMessages.map((m) => ({ ...m, source: 'web' as const })),
	].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

	return json({ conversation: conv, messages: allMessages });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await db.delete(conversations).where(eq(conversations.id, params.id));
	return json({ deleted: true });
};
