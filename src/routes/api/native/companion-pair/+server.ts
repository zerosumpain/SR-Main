import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { satisfies } from '$lib/access/catalogue';
import { withNativeAccess } from '$lib/server/native-handler';
import { loadMember } from '$lib/server/grants';
import { pilotFailureText, pilotPairCode, upsertPilotUser } from '$lib/home/presence/companion-accounts';
import { memberByEmail } from '$lib/home/presence/members';

/**
 * POST /api/native/companion-pair — the phone's health & location pairing,
 * fetched through its site credential. Answers `{ server, code }`, a ten-minute
 * companion code the phone redeems at once.
 *
 * This is how someone who registered from the app gets connected without a
 * QR: approval makes their site credential a member's, and the phone asks here
 * next. The same rule as /welcome's pairing step: the owner, or a member in
 * the family circle — health and location are the household's. Anyone else
 * is refused, and the app leaves Health unconnected.
 */
export const POST = withNativeAccess('any', async (_event, identity, role) => {
  const email = identity.ownerEmail;
  if (role !== 'owner') {
    const member = await loadMember(email);
    if (!member || !satisfies(member.grants, 'family:circle')) {
      return json({ error: 'Health and location are for the family.' }, { status: 403 });
    }
  }
  const household = await memberByEmail(email).catch(() => null);
  const name = household?.displayName ?? email.split('@')[0];
  const user = await upsertPilotUser(email, name);
  if (!user.ok) return json({ error: pilotFailureText(user.reason) }, { status: 502 });
  const pair = await pilotPairCode(email);
  if (!pair.ok) return json({ error: pilotFailureText(pair.reason) }, { status: 502 });
  let server = '';
  try {
    const payload = JSON.parse(pair.value.payload) as { server?: unknown };
    server = typeof payload.server === 'string' ? payload.server : '';
  } catch {
    /* handled below */
  }
  if (!server) return json({ error: 'The app server did not say where it is.' }, { status: 502 });
  return { server, code: pair.value.code };
}) satisfies RequestHandler;
