import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
// The caps are defined alongside createStudioBuild and enforced there too —
// the `studio_build` chat tool is a second entry point that never reaches this
// route. Imported rather than re-declared so the two cannot drift; this route
// keeps its own check only to answer 400 instead of 500.
import { createStudioBuild, MAX_CHALLENGE_LEN, MAX_TITLE_LEN } from '$lib/jkai/studio';

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
  const title = typeof body.title === 'string' ? body.title : undefined;
  if (title && title.trim().length > MAX_TITLE_LEN) {
    return json({ error: `title too long (max ${MAX_TITLE_LEN} chars)` }, { status: 400 });
  }
  try {
    const { buildId } = await createStudioBuild({ challenge, title });
    return json({ buildId, url: `/jkai/builds/${buildId}` });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
