import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  // Find the WhatsApp conversation for this phone number
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.whatsappPhoneNumber, phoneNumber))
    .limit(1);

  if (!conv) {
    return json({ messages: [] });
  }

  const messages = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, conv.id))
    .orderBy(asc(orchestratorChats.createdAt));

  return json({ messages });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const { phoneNumber } = params;

  // Find the WhatsApp conversation for this phone number
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.whatsappPhoneNumber, phoneNumber))
    .limit(1);

  if (conv) {
    await db
      .delete(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conv.id));
  }

  return json({ cleared: true });
};
