import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiConversations, jkaiMessages } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');

  if (id) {
    // Get single conversation with messages
    const conv = await db.query.jkaiConversations.findFirst({
      where: eq(jkaiConversations.id, id),
    });
    if (!conv) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }
    const messages = await db
      .select()
      .from(jkaiMessages)
      .where(eq(jkaiMessages.conversationId, id))
      .orderBy(jkaiMessages.createdAt);

    return Response.json({ ...conv, messages });
  }

  // List conversations
  const conversations = await db
    .select()
    .from(jkaiConversations)
    .orderBy(desc(jkaiConversations.updatedAt))
    .limit(50);

  return Response.json(conversations);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'No id provided' }), { status: 400 });
  }

  await db.delete(jkaiConversations).where(eq(jkaiConversations.id, id));
  return Response.json({ ok: true });
};
