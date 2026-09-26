import { fail } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { getOwnerEmails } from '$lib/server/access';
import { submitAccessRequest } from '$lib/server/access-requests';
import { INVITE_COOKIE } from '$lib/server/invites';
import { isOwnerRequest } from '$lib/server/owner';
import { clientIp, hashIp } from '$lib/server/public-request-rate-limit';
import { viewerHolds, viewerOf } from '$lib/server/viewer';
import { loadCompanionUsers } from '$lib/home/presence/companion';
import {
  pilotFailureText,
  pilotPairCode,
  setPilotSharing,
  upsertPilotUser,
} from '$lib/home/presence/companion-accounts';

// /welcome is PUBLIC ($lib/auth PUBLIC_PATHS): the hook lets everyone through,
// and this file decides what each visitor gets.
//
//  - Signed out: the request-access form and a way to sign in.
//  - Signed in (which means allowed — sign-in is the allow-list gate): the
//    three setup steps. Pairing and sharing need `family:circle` (or owner);
//    without it the steps say to ask John.
//
// Every action re-reads the session itself. None of them trusts the page.

interface Here {
  email: string;
  name: string;
  isOwner: boolean;
  canPair: boolean;
}

/** Who is looking, or null for a signed-out visitor. */
async function whoIsHere(event: Pick<RequestEvent, 'locals' | 'getClientAddress'>): Promise<Here | null> {
  const session = await event.locals.auth().catch(() => null);
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  if (email) {
    const viewer = await viewerOf(event);
    const isOwner = viewer.kind === 'owner';
    return {
      email,
      name: session?.user?.name?.trim() || email.split('@')[0],
      isOwner,
      canPair: isOwner || viewerHolds(viewer, 'family:circle'),
    };
  }
  // Dev only: the LAN bypass has no session (Google refuses private redirect
  // URIs), so the box itself previews the owner's view. `isOwnerRequest` never
  // returns true for a sessionless request in a production build.
  if (await isOwnerRequest(event)) {
    const owner = getOwnerEmails()[0];
    if (owner) return { email: owner, name: 'John', isOwner: true, canPair: true };
  }
  return null;
}

function testflightUrl(): string | null {
  const url = env.APPLE_TESTFLIGHT_URL?.trim();
  return url && /^https:\/\//.test(url) ? url : null;
}

export const load: PageServerLoad = async (event) => {
  const here = await whoIsHere(event);
  if (!here) return { signedIn: false as const, testflight: testflightUrl() !== null };

  // Signed in: whatever the invite cookie carried has done its work.
  event.cookies.delete(INVITE_COOKIE, { path: '/' });

  let sharing: boolean | null = null;
  if (here.canPair) {
    const users = await loadCompanionUsers().catch(() => null);
    const me = users?.find((u) => u.email.toLowerCase() === here.email);
    sharing = me ? me.sharing : null;
  }
  return {
    signedIn: true as const,
    name: here.name,
    email: here.email,
    isOwner: here.isOwner,
    canPair: here.canPair,
    sharing,
    testflightUrl: testflightUrl(),
  };
};

export const actions: Actions = {
  /** The public request-access form. Same answer for every well-formed request. */
  request: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const raw = {
      name: form.get('name'),
      email: form.get('email'),
      message: form.get('message'),
      app: form.get('app'),
      website: form.get('website'),
    };
    const values = {
      name: typeof raw.name === 'string' ? raw.name : '',
      email: typeof raw.email === 'string' ? raw.email : '',
      message: typeof raw.message === 'string' ? raw.message : '',
    };
    const ipHash = hashIp(clientIp(request, getClientAddress));
    const result = await submitAccessRequest(raw, ipHash).catch((err) => {
      console.error('[welcome] request failed:', err);
      return null;
    });
    if (!result) return fail(500, { requestError: 'Something went wrong. Please try again in a minute.', values });
    if (result.status === 'limited') {
      return fail(429, { requestError: 'That is a lot of requests from here. Please try again later.', values });
    }
    if (result.status === 'invalid') {
      return fail(400, { requestError: result.error, field: result.field, values });
    }
    return { requested: true };
  },

  /** Step 2: make sure they exist on the app server, then mint a ten-minute code. */
  pair: async (event) => {
    const here = await whoIsHere(event);
    if (!here) return fail(401, { pairError: 'Sign in first.' });
    if (!here.canPair) return fail(403, { pairError: 'Ask John to add you to Family Circle first.' });
    const user = await upsertPilotUser(here.email, here.name);
    if (!user.ok) return fail(502, { pairError: pilotFailureText(user.reason) });
    const code = await pilotPairCode(here.email);
    if (!code.ok) return fail(502, { pairError: pilotFailureText(code.reason) });
    const qr = await QRCode.toDataURL(code.value.payload, { errorCorrectionLevel: 'M', margin: 2, scale: 7 });
    return {
      pair: { qr, code: code.value.code, expiresAt: Date.now() + code.value.expiresIn * 1000 },
    };
  },

  /** Step 3: location sharing on or off. */
  sharing: async (event) => {
    const here = await whoIsHere(event);
    if (!here) return fail(401, { sharingError: 'Sign in first.' });
    if (!here.canPair) return fail(403, { sharingError: 'Ask John to add you to Family Circle first.' });
    const form = await event.request.formData();
    const enabled = form.get('enabled') === 'true';
    // Sharing is set on an account, so make sure there is one — someone may
    // decide this before they have paired.
    const user = await upsertPilotUser(here.email, here.name);
    if (!user.ok) return fail(502, { sharingError: pilotFailureText(user.reason) });
    const r = await setPilotSharing(here.email, enabled);
    if (!r.ok) return fail(502, { sharingError: pilotFailureText(r.reason) });
    return { sharing: r.value.sharing };
  },
};
