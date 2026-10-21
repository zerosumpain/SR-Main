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
import {
  adhocBuildOf,
  adhocBuildRunning,
  latestAppBuild,
  latestTestFlightRun,
  listAdhocDrafts,
  startAdhocBuild,
  type AdhocDraft,
} from '$lib/github/adhoc-builds';
import { buildState, chooseReleased, currentRelease, releaseBuild } from '$lib/github/app-release';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page and its actions.
//
// The fleet (`$lib/access/fleet`): one row per phone, both lanes merged where
// the phone said who it is, what it is running against the released build,
// and the ad-hoc copy the family install from. Nothing is minted or revoked
// here — that is the person's page; every row links to it. The fleet's own
// actions: rebuild the ad-hoc copy, and choose which build the family's
// phones are offered (Releases, `$lib/github/app-release`).

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
  const [site, pilot, names, enrolled, latest, drafts, testflight, running, members, fixes] = await Promise.all([
    attempt(listAllSiteDevices(), 'site list'),
    listPilotDevices(),
    namesByEmail(viewer).catch(() => new Map<string, string>()),
    attempt(listAppDevices(), 'enrolled phones'),
    attempt(latestAppBuild(), 'latest build'),
    attempt(listAdhocDrafts(), 'ad-hoc copies'),
    attempt(latestTestFlightRun(), 'TestFlight run'),
    adhocBuildRunning().catch(() => false),
    listMembers().catch(() => []),
    lastFixBySubject().catch(() => new Map()),
  ]);

  // The releases: which copy the family are offered, and every copy GitHub
  // still holds (`$lib/github/app-release`).
  const held: AdhocDraft[] = drafts.ok ? drafts.value : [];
  const release = drafts.ok ? await attempt(currentRelease(held), 'release record') : { ok: false as const };
  const offeredDraft = release.ok && release.value ? chooseReleased(held, release.value) : null;
  const builds = await Promise.all(
    held.map(async (d) => {
      const meta = await adhocBuildOf(d).catch(() => null);
      return {
        run: d.run,
        commit: d.commit,
        builtAt: meta?.builtAt ?? d.createdAt,
        version: meta?.version ?? `0.1.${d.run}`,
        devices: meta?.devices.length ?? null,
        state: buildState(d, release.ok ? release.value : null, offeredDraft),
      };
    }),
  );
  const offered = offeredDraft ? await adhocBuildOf(offeredDraft).catch(() => null) : null;
  const copy = { ok: drafts.ok, value: offered };

  const rows = mergeDeviceRows(site.ok ? site.value : [], pilot.ok ? pilot.value : [], names, new Date());
  // Phones are graded against what they are offered: a build the family
  // have not been released is not one they are behind.
  const latestBuild = offeredDraft ? offeredDraft.run : latest.ok && latest.value ? latest.value.build : null;
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
    releases: {
      readable: drafts.ok && release.ok,
      release: release.ok ? release.value : null,
      offered: offeredDraft?.run ?? null,
      builds,
      testflight: testflight.ok ? testflight.value : undefined,
      repo: 'https://github.com/zerosumpain/SR-AppleApp',
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

  /**
   * Offer build N to the family's phones — a newer one (release) or an older
   * one (roll back). /app, /install and the hourly update check follow at once.
   */
  release: async ({ request, locals }) => {
    const run = Number((await request.formData()).get('build'));
    if (!Number.isInteger(run) || run <= 0) return fail(400, { releaseError: 'Which build?' });
    const session = await locals.auth();
    const by = (session?.user?.email ?? '').toLowerCase() || null;
    const outcome = await releaseBuild(run, by).catch((err) => {
      console.error('[fleet] release failed:', err);
      return { ok: false as const, error: 'The release could not be saved.' };
    });
    if (!outcome.ok) return fail(400, { releaseError: outcome.error });
    return { released: run };
  },

  /** Forget an enrolled phone here. It stays in the signing profile until the next build drops it. */
  forget: async ({ request }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'Which phone?' });
    return (await removeAppDevice(id)) ? { forgot: id } : fail(404, { error: 'That phone is not listed.' });
  },
};
