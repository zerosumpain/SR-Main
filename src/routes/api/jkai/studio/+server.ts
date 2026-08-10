import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { createStudioBuild } from '$lib/jkai/studio';

const MAX_CHALLENGE_LEN = 4_000;

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  if (!isOwnerEmail(session?.user?.email)) {
    return json({ error: 'Not found' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const challenge = typeof body.challenge === 'string' ? body.challenge : '';
  if (!challenge.trim()) {
    return json({ error: 'challenge is required' }, { status: 400 });
  }
  if (challenge.length > MAX_CHALLENGE_LEN) {
    return json({ error: `challenge too long (max ${MAX_CHALLENGE_LEN} chars)` }, { status: 400 });
  }
  try {
    const { buildId } = await createStudioBuild({
      challenge,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    return json({ buildId, url: `/jkai/builds/${buildId}` });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
