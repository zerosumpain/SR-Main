import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConversationList } from '$lib/jkai/queries';

export const GET: RequestHandler = async () => {
	const rows = await getConversationList();
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
