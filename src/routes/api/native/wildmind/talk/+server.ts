import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { TalkSchema, talkQuery } from '$lib/wildmind/owner';
import { readOwner } from '$lib/wildmind/owner.server';

/**
 * GET /api/native/wildmind/talk — what JKai and Wren said, thought, wrote in
 * their diaries and heard whispered, NEWEST FIRST. Owner only, and owner-only
 * prose (see $lib/wildmind/owner).
 *
 * `?before=<id>` pages older, `?since=<id>` returns newer, `?limit=1..200`
 * (100), `?who=main|companion`, `?kinds=speech,thought,whisper,diary`; each is
 * checked and anything malformed is left out, never forwarded. Wildmind's
 * shape, re-validated, with `state: 'live'`; `{ state: 'offline' }` (200) when
 * the lane is closed or Wildmind does not answer. A new valley shows as a
 * changed `valley.seed`.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => readOwner('talk', talkQuery(url.searchParams), TalkSchema));
