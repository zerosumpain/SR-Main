import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

// Read-only public view of a shared jkai conversation. This route lives under
// the /jkai/shared public prefix (see src/lib/auth.ts), so it self-gates:
//   private → 404 (or unknown token); 'users' → requires a signed-in session;
//   'public' → anyone with the link.
export const load: PageServerLoad = async ({ params, locals }) => {
  const [conv] = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      shareVisibility: conversations.shareVisibility,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.shareToken, params.token))
    .limit(1);

  if (!conv || conv.shareVisibility === 'private') {
    throw error(404, 'This shared conversation is not available.');
  }

  if (conv.shareVisibility === 'users') {
    const session = await locals.auth();
    if (!session?.user) {
      // Send anonymous visitors to sign in; the link works once they're in.
      throw redirect(303, '/login');
    }
  }

  const rows = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      content: orchestratorChats.content,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, conv.id))
    .orderBy(asc(orchestratorChats.createdAt));

  // Whitelist what leaves the server: real user/assistant turns only, and only
  // role/content/timestamp — never metadata (toolSteps, fileRefs, sessionIds).
  const messages = rows
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        (m.metadata as { source?: string } | null)?.source !== 'status_update',
    )
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

  return {
    title: conv.title,
    visibility: conv.shareVisibility as 'users' | 'public',
    updatedAt: conv.updatedAt.toISOString(),
    messages,
  };
};
