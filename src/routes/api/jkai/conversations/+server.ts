import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const rows = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			source: conversations.source,
			whatsappPhoneNumber: conversations.whatsappPhoneNumber,
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
			messageCount: sql<number>`(
        select count(*) from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
      )`.as('message_count'),
			lastMessage: sql<string>`(
        select content from orchestrator_chats
        where orchestrator_chats.conversation_id = "jkai_conversations"."id"
        order by created_at desc limit 1
      )`.as('last_message'),
		})
		.from(conversations)
		.orderBy(desc(conversations.updatedAt));

	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { title, source, whatsappPhoneNumber } = body;

	const [conv] = await db
		.insert(conversations)
		.values({
			title: title || null,
			source: source || 'web',
			whatsappPhoneNumber: whatsappPhoneNumber || null,
		})
		.returning();

	return json(conv, { status: 201 });
};
