import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { findSharedSession } from '$lib/deepdive/share';

export const load: PageServerLoad = async ({ params }) => {
  // Compared by hash; a pre-2026-10-02 plaintext link is upgraded on first use.
  const session = await findSharedSession(params.token);
  if (!session) throw error(404, 'Not found');

  return {
    readonly: true as const,
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    },
  };
};
