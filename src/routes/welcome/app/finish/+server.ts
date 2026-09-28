import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { createPairingCode } from '$lib/server/native-auth';
import { REGISTER_COOKIE, ensureAppRequest, isRegisterNonce } from '$lib/server/registration';

// Where Google hands back during a registration from the iPhone app. PUBLIC
// (in $lib/auth PUBLIC_PATHS); it needs the session Google just made and the
// cookie /welcome/app set, and answers nothing without both.
//
// The person's request is recorded (once — see ensureAppRequest), a one-time
// pairing code is minted for their email, and the browser is sent to
// `srapp://registered?code=…`, which the app's sign-in sheet catches. The web
// session is then thrown away: it existed only to learn who they are, and the
// sheet is private and closes anyway.

const BACK = 'srapp://registered';

/** Auth.js's session cookie, under either name it uses (secure in production). */
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

export const GET: RequestHandler = async ({ locals, cookies }) => {
  const back = (params: Record<string, string>) => `${BACK}?${new URLSearchParams(params)}`;
  const nonce = cookies.get(REGISTER_COOKIE);
  const session = (await locals.auth().catch(() => null)) as { user?: { email?: string | null; name?: string | null }; registerNonce?: string } | null;
  const email = (session?.user?.email ?? '').trim().toLowerCase();

  // Only the session THIS flow's sign-in made: it carries the nonce the
  // start page set (hooks.server.ts, jwt). A session the browser already had
  // — the owner's, a member's — carries none and gets nothing, not even
  // signed out.
  if (!isRegisterNonce(nonce) || !email || session?.registerNonce !== nonce) {
    redirect(303, back({ error: 'The sign-in did not finish. Try again.' }));
  }
  cookies.delete(REGISTER_COOKIE, { path: '/' });
  for (const name of SESSION_COOKIES) cookies.delete(name, { path: '/' });

  // Never the owner. Their phone opens every owner route and is paired from
  // an owner session by QR. Here, a page could walk the owner's signed-in
  // browser through this flow (Google completes silently once consented) and
  // the code would go to whichever app claims `srapp://` on that phone.
  if (isOwnerEmail(email)) redirect(303, back({ error: 'Pair the owner’s iPhone from the website.' }));

  // Anyone already allowed just gets their phone connected: signing in from
  // the app is also the easy way back in for a known person. Someone refused
  // still gets a code: their phone then says "not approved" rather than
  // showing a sign-in that silently went nowhere.
  await ensureAppRequest({ email, name: session?.user?.name ?? null, via: 'google' });
  const { code } = await createPairingCode(email);
  redirect(303, back({ code }));
};
