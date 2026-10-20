import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { getOwnerEmails } from '$lib/server/access';
import { listAllSiteDevices } from '$lib/server/site-devices';
import { listAppDevices, removeAppDevice } from '$lib/server/app-devices';
import { cleanDeviceName, cleanUdid } from '$lib/server/adhoc-install';
import { listPilotDevices, pilotFailureText } from '$lib/home/presence/companion-accounts';
import { listMembers } from '$lib/home/presence/members';
import { lastFixBySubject } from '$lib/home/presence/fleet-trail';
import { mergeDeviceRows } from '$lib/access/device-rows';
import { buildFleet } from '$lib/access/fleet';
import { adhocBuildRunning, latestAdhocBuild, latestAppBuild, startAdhocBuild } from '$lib/github/adhoc-builds';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page and its actions.
//
// The fleet (`$lib/access/fleet`): one row per phone, both lanes merged where
// the phone said who it is, what it is running against the newest build, and
// the ad-hoc copy the under-13s install from. Nothing is minted or revoked
// here — that is the person's page; every row links to it. The one action
// that is the fleet's own is a rebuild of the ad-hoc copy.

async function namesByEmail(viewer: string | null): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rows = await db.select({ email: allowedUser.email, note: allowedUser.note }).from(allowedUser);
  for (const r of rows) if (r.note?.trim()) names.set(r.email.toLowerCase(), r.note.trim());
  for (const owner of getOwnerEmails()) names.set(owner, owner === viewer ? 'You' : owner);
  return names;
}

const attempt = <T>(p: Promise<T>, what: string) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => {
      console.error(`[fleet] ${what} failed:`, err);
      return { ok: false as const };
    },
  );

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();
  const viewer = (session?.user?.email ?? '').toLowerCase() || null;

  // Every source on its own: GitHub, the pilot or the trail being down must
  // never take the phone list with it.
  const [site, pilot, names, enrolled, latest, copy, running, members, fixes] = await Promise.all([
    attempt(listAllSiteDevices(), 'site list'),
    listPilotDevices(),
    namesByEmail(viewer).catch(() => new Map<string, string>()),
    attempt(listAppDevices(), 'enrolled phones'),
    attempt(latestAppBuild(), 'latest build'),
    attempt(latestAdhocBuild(), 'ad-hoc copy'),
    adhocBuildRunning().catch(() => false),
    listMembers().catch(() => []),
    lastFixBySubject().catch(() => new Map()),
  ]);

  const rows = mergeDeviceRows(site.ok ? site.value : [], pilot.ok ? pilot.value : [], names, new Date());
  const latestBuild = latest.ok && latest.value ? latest.value.build : copy.ok && copy.value ? Number(copy.value.build) || null : null;
  const fleet = buildFleet({
    rows,
    enrolled: enrolled.ok ? enrolled.value : [],
    latestBuild,
    copyDevices: copy.ok ? (copy.value?.devices ?? []) : null,
    names,
    now: new Date(),
  });

  // The companion's last fix and battery, by address (the trail is by subject).
  const lastFix: Record<string, { at: string; batteryPct: number | null }> = {};
  for (const m of members) {
    const f = m.email ? fixes.get(m.subject) : undefined;
    if (m.email && f) lastFix[m.email.toLowerCase()] = { at: f.at.toISOString(), batteryPct: f.batteryPct };
  }

  return {
    fleet,
    lastFix,
    pipeline: {
      latest: latest.ok ? latest.value : undefined,
      copy: copy.ok ? copy.value && { version: copy.value.version, build: copy.value.build, builtAt: copy.value.builtAt, devices: copy.value.devices } : undefined,
      running,
      appUrl: `${url.origin}/app`,
    },
    warnings: [
      ...(site.ok ? [] : ['The site’s phone list could not be read.']),
      ...(pilot.ok ? [] : [`Health & location: ${pilotFailureText(pilot.reason)}`]),
      ...(enrolled.ok ? [] : ['The enrolled phones could not be read.']),
    ],
  };
};

export const actions: Actions = {
  /** A fresh ad-hoc copy now — for a UDID read off a computer, or just the newest app for the phones already listed. */
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
      console.error('[fleet] could not start the ad-hoc build:', err);
      return fail(502, { adhocError: 'GitHub would not start the build. Run Upload to TestFlight by hand, with testflight off.' });
    }
    return { adhocStarted: device?.name ?? 'the newest app' };
  },

  /** Forget an enrolled phone here. It stays in the signing profile until the next build drops it. */
  forget: async ({ request }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Which phone?' });
    return (await removeAppDevice(id)) ? { forgot: id } : fail(404, { error: 'That phone is not listed.' });
  },
};
