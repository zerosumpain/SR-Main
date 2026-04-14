import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { asc, desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	// Find the most recent phone number with conversations
	const [latest] = await db
		.select({ phoneNumber: whatsappConversations.phoneNumber })
		.from(whatsappConversations)
		.orderBy(desc(whatsappConversations.createdAt))
		.limit(1);

	if (!latest) {
		return json({ phoneNumber: null, messages: [] });
	}

	const { phoneNumber } = latest;

	// Load all messages for that phone number
	const messages = await db
		.select({
			id: whatsappConversations.id,
			role: whatsappConversations.role,
			content: whatsappConversations.content,
			createdAt: whatsappConversations.createdAt
		})
		.from(whatsappConversations)
		.where(eq(whatsappConversations.phoneNumber, phoneNumber))
		.orderBy(asc(whatsappConversations.createdAt));

	return json({ phoneNumber, messages });
};
