import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { hasStudioServiceToken } from '$lib/server/studio-auth';
import { rateLimit } from '$lib/server/rate-limit';
// The caps are defined alongside createStudioBuild and enforced there too —
// the `studio_build` chat tool is a second entry point that never reaches this
// route. Imported rather than re-declared so the two cannot drift; this route
// keeps its own check only to answer 400 instead of 500.
import { RESEARCH_MODES, type ResearchMode } from '$lib/jkai/research-brief';
import { createStudioBuild, MAX_CHALLENGE_LEN, MAX_TITLE_LEN } from '$lib/jkai/studio';

export const POST: RequestHandler = async ({ request, locals }) => {
  // Owner session OR the studio service token. The hook lets a valid tokened
  // POST through without a session, so this re-check is what actually enforces
  // it at the route — defence in depth, matching how the maintenance endpoints
  // re-check their own secret rather than trusting the hook alone.
  const viaToken = hasStudioServiceToken(request);
  if (!viaToken) {
    const session = await locals.auth();
    if (!isOwnerEmail(session?.user?.email)) {
      return json({ error: 'Not found' }, { status: 404 });
    }
  } else {
    // The hook's RATE_LIMITS pass is skipped for a tokened call (it returns
    // before reaching it), so the ceiling has to be enforced here or the token
    // would have none. Same 3/hour as the session path.
    const gate = rateLimit('studio-service-token', { capacity: 3, refillPerSecond: 3 / 3600 });
    if (!gate.allowed) {
      return json({ error: 'Rate limited — studio builds are capped at 3/hour.' }, { status: 429 });
    }
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
    const researchMode = RESEARCH_MODES.includes(body.researchMode as ResearchMode)
      ? (body.researchMode as ResearchMode)
      : undefined;
    const { buildId } = await createStudioBuild({
      challenge,
      title,
      ...(researchMode ? { researchMode } : {}),
    });
    return json({ buildId, url: `/jkai/builds/${buildId}` });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
