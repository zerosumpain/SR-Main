import { fail } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { env } from '$env/dynamic/private';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { createPairingCode, revokeDevice } from '$lib/server/native-auth';
import { scanPairPayload } from '$lib/server/pair-payload';
import { addToAllowList } from '$lib/server/allow-list';
import { joinGroups } from '$lib/server/invites';
import { PRE_REGISTERED_GROUP } from '$lib/server/registration';
import { eq } from 'drizzle-orm';
import { listAllSiteDevices } from '$lib/server/site-devices';
import {
  listPilotDevices,
  pilotFailureText,
  revokePilotDevice,
} from '$lib/home/presence/companion-accounts';
import { mergeDeviceRows } from '$lib/access/device-rows';
import { cleanDeviceName, cleanUdid, joinSlug, mintJoinCode, JOIN_DAYS } from '$lib/server/adhoc-install';
import { listMembers, updateMember } from '$lib/home/presence/members';
import { adhocBuildRunning, latestAdhocBuild, startAdhocBuild } from '$lib/github/adhoc-builds';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page and its actions.

async function namesByEmail(viewer: string | null): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rows = await db.select({ email: allowedUser.email, note: allowedUser.note }).from(allowedUser);
  for (const r of rows) if (r.note?.trim()) names.set(r.email.toLowerCase(), r.note.trim());
  for (const owner of getOwnerEmails()) names.set(owner, owner === viewer ? 'You' : owner);
  return names;
}

/** Install without TestFlight (`$lib/server/adhoc-install`): the newest copy, and whether one is building. */
async function adhocState(origin: string) {
  const [build, running] = await Promise.all([
    latestAdhocBuild().then(
      (b) => ({ ok: true as const, value: b }),
      (err) => {
        console.error('[devices] ad-hoc build unreadable:', err);
        return { ok: false as const };
      },
    ),
    adhocBuildRunning().catch(() => false),
  ]);
  const members = await listMembers().catch(() => []);
  const people = [...new Set(members.map((m) => m.displayName.trim().split(/\s+/)[0]).filter(Boolean))].sort();
  // For "pair a phone for someone": everyone in the household, with their
  // address when they have one. Someone without one is offered too — pairing
  // them is what links them (`vouchPair`).
  const household = members
    .map((m) => ({ name: m.displayName.trim(), email: m.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    appUrl: `${origin}/app`,
    people,
    household,
    readable: build.ok,
    build: build.ok && build.value ? { version: build.value.version, builtAt: build.value.builtAt, devices: build.value.devices } : null,
    running,
  };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();
  const viewer = (session?.user?.email ?? '').toLowerCase() || null;

  // The two lanes are fetched independently: the pilot being down must never
  // take the site's own list with it, and vice versa.
  const [site, pilot, names, adhoc] = await Promise.all([
    listAllSiteDevices().then(
      (v) => ({ ok: true as const, value: v }),
      (err) => {
        console.error('[devices] site list failed:', err);
        return { ok: false as const };
      },
    ),
    listPilotDevices(),
    namesByEmail(viewer).catch(() => new Map<string, string>()),
    adhocState(url.origin),
  ]);

  const rows = mergeDeviceRows(site.ok ? site.value : [], pilot.ok ? pilot.value : [], names, new Date());
  return {
    rows,
    site: site.ok ? { ok: true as const } : { ok: false as const, message: 'The site’s device list could not be read.' },
    pilot: pilot.ok ? { ok: true as const } : { ok: false as const, message: pilotFailureText(pilot.reason) },
    adhoc,
  };
};

type HouseholdLink =
  | { state: 'already'; name: string }
  | { state: 'linked'; name: string }
  | { state: 'other-email'; name: string }
  | { state: 'unlinked' };

/** Put `email` on the one household person called `name` who has no address yet. */
async function linkHousehold(name: string, email: string): Promise<HouseholdLink> {
  const members = await listMembers();
  const mine = members.find((m) => m.email?.toLowerCase() === email);
  if (mine) return { state: 'already', name: mine.displayName };
  const wanted = name.trim().toLowerCase();
  const first = wanted.split(/\s+/)[0];
  const byName = members.filter((m) => m.displayName.trim().toLowerCase() === wanted);
  const candidates = byName.length ? byName : members.filter((m) => m.displayName.trim().toLowerCase().split(/\s+/)[0] === first);
  if (candidates.length !== 1) return { state: 'unlinked' };
  const [row] = candidates;
  if (row.email) return { state: 'other-email', name: row.displayName };
  await updateMember(row.subject, { email });
  return { state: 'linked', name: row.displayName };
}

export const actions: Actions = {
  revoke: async ({ request }) => {
    const form = await request.formData();
    const lane = form.get('lane');
    const id = String(form.get('id') ?? '');
    const email = String(form.get('email') ?? '');
    if (!id) return fail(400, { error: 'Which device?' });
    if (lane === 'site') {
      if (!email) return fail(400, { error: 'Whose device?' });
      const ok = await revokeDevice(email, id);
      return ok ? { revoked: id } : fail(404, { error: 'That device is already revoked.' });
    }
    if (lane === 'companion') {
      const r = await revokePilotDevice(id);
      if (r.ok) return { revoked: id };
      return fail(r.reason === 'not-found' ? 404 : 502, { error: pilotFailureText(r.reason) });
    }
    return fail(400, { error: 'Unknown pairing.' });
  },

  /** A week's link for one person, for any of their phones: it tells the site the phone's UDID and starts a build. */
  joinLink: async ({ request, url }) => {
    const form = await request.formData();
    const slug = joinSlug(form.get('name'));
    if (!slug) return fail(400, { adhocError: 'Give their first name, like Rory.' });
    const link = `${url.origin}/app/${mintJoinCode(slug, env.AUTH_SECRET)}`;
    const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 4, scale: 5 });
    return { join: { name: slug.charAt(0).toUpperCase() + slug.slice(1), link, qr, days: JOIN_DAYS } };
  },

  /**
   * A pairing code the owner vouches for, for someone who cannot sign in on
   * the phone: Apple will not let an under-13 account use Sign in with Apple
   * for a new app, so the app's own "sign in as this phone" step can never
   * work for a child. The code is minted FOR the named person and redeemed
   * without a sign-in (`kind: 'pair'`), so it pairs whichever phone scans it
   * as them — the owner shows it to that phone, and only that phone.
   *
   * They join the allow-list in Family Circle first, as a pre-registered
   * member would. Someone already on it is left alone: any write to their
   * allow-list row revokes every phone they hold (the security trigger).
   *
   * And their household place gets the address, when exactly one household
   * person of that name has none yet — otherwise the account and the person
   * on the map stay two strangers (no family tabs, no place on /home/people),
   * which is what pairing Rory left on 2026-10-19. That write is to the
   * household row only, never the allow-list, so it revokes nothing.
   */
  vouchPair: async ({ request, url, locals }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim().slice(0, 60);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    if (!name) return fail(400, { vouchError: 'Whose phone is it?' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, { vouchError: 'Give their email address — their Apple ID’s will do.' });
    if (isOwnerEmail(email)) return fail(400, { vouchError: 'That is your own address. Pair your phone above.' });

    const [listed] = await db.select({ email: allowedUser.email }).from(allowedUser).where(eq(allowedUser.email, email)).limit(1);
    if (!listed) {
      const session = await locals.auth();
      await addToAllowList({ email, note: name, addedBy: session?.user?.email ?? null });
      await joinGroups(email, [PRE_REGISTERED_GROUP]);
    }
    const household = await linkHousehold(name, email).catch((err) => {
      console.error('[devices] household link failed:', err);
      return { state: 'unlinked' as const };
    });
    const { code, expiresAt } = await createPairingCode(email);
    const qr = await QRCode.toDataURL(scanPairPayload(url.origin, code), { errorCorrectionLevel: 'M', margin: 4, scale: 6 });
    return { vouch: { name, email, code, qr, expiresAt: expiresAt.toISOString(), admitted: !listed, household } };
  },

  /** A fresh copy now — for a UDID read off a computer, or just the newest app. */
  adhocBuild: async ({ request }) => {
    const form = await request.formData();
    const rawUdid = String(form.get('udid') ?? '').trim();
    let device: { udid: string; name: string } | undefined;
    if (rawUdid) {
      const udid = cleanUdid(rawUdid);
      const name = cleanDeviceName(form.get('name'));
      if (!udid) return fail(400, { adhocError: 'That is not a UDID: 8 characters, a dash and 16 more, or 40 on older phones.' });
      if (!name) return fail(400, { adhocError: 'Name the phone too, like Rory’s iPhone.' });
      device = { udid, name };
    }
    try {
      await startAdhocBuild(device);
    } catch (err) {
      console.error('[devices] could not start the ad-hoc build:', err);
      return fail(502, { adhocError: 'GitHub would not start the build. Run Upload to TestFlight by hand, with testflight off.' });
    }
    return { adhocStarted: device?.name ?? 'the newest app' };
  },
};
