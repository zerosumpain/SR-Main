import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { getOwnerEmails } from '$lib/server/access';
import { revokeDevice } from '$lib/server/native-auth';
import { listAllSiteDevices } from '$lib/server/site-devices';
import {
  listPilotDevices,
  pilotFailureText,
  revokePilotDevice,
} from '$lib/home/presence/companion-accounts';
import { mergeDeviceRows } from '$lib/access/device-rows';
import { cleanDeviceName, cleanUdid } from '$lib/server/adhoc-install';
import { adhocBuildRunning, latestAdhocBuild, startAdhocBuild } from '$lib/github/adhoc-builds';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page and its actions.
//
// The fleet: every phone on both lanes, and the ad-hoc build they install
// from. Nothing is minted here any more — a pairing code or a join link is
// made from the PERSON's page (`$lib/people/connect`), so there is one place
// that admits someone and one place that connects their phone (2026-10-20).

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
  return {
    appUrl: `${origin}/app`,
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

  /** A fresh copy now — for a UDID read off a computer, or just the newest app. Fleet-level, so it stays here. */
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
