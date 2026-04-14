import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  const messages = await db
    .select()
    .from(whatsappConversations)
    .where(eq(whatsappConversations.phoneNumber, phoneNumber))
    .orderBy(asc(whatsappConversations.createdAt));

  return json({ messages });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  await db
    .delete(whatsappConversations)
    .where(eq(whatsappConversations.phoneNumber, phoneNumber));

  return json({ cleared: true });
};
