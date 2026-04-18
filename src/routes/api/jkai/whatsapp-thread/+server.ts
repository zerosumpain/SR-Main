import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { asc, desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	// Find the most recent WhatsApp conversation (now unified in jkai_conversations)
	const [latest] = await db
		.select({ id: conversations.id, phoneNumber: conversations.whatsappPhoneNumber })
		.from(conversations)
		.where(eq(conversations.source, 'whatsapp'))
		.orderBy(desc(conversations.updatedAt))
		.limit(1);

	if (!latest?.phoneNumber) {
		return json({ phoneNumber: null, messages: [] });
	}

	const { phoneNumber } = latest;

	// Load all messages from orchestrator_chats for this conversation
	const messages = await db
		.select({
			id: orchestratorChats.id,
			role: orchestratorChats.role,
			content: orchestratorChats.content,
			createdAt: orchestratorChats.createdAt
		})
		.from(orchestratorChats)
		.where(eq(orchestratorChats.conversationId, latest.id))
		.orderBy(asc(orchestratorChats.createdAt));

	return json({ phoneNumber, messages });
};
