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
import { mergeDeviceRows } from './rows';

// Owner-only: /admin is never in the access catalogue, so the hook's default
// deny covers this page and its actions.

async function namesByEmail(viewer: string | null): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rows = await db.select({ email: allowedUser.email, note: allowedUser.note }).from(allowedUser);
  for (const r of rows) if (r.note?.trim()) names.set(r.email.toLowerCase(), r.note.trim());
  for (const owner of getOwnerEmails()) names.set(owner, owner === viewer ? 'You' : owner);
  return names;
}

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  const viewer = (session?.user?.email ?? '').toLowerCase() || null;

  // The two lanes are fetched independently: the pilot being down must never
  // take the site's own list with it, and vice versa.
  const [site, pilot, names] = await Promise.all([
    listAllSiteDevices().then(
      (v) => ({ ok: true as const, value: v }),
      (err) => {
        console.error('[devices] site list failed:', err);
        return { ok: false as const };
      },
    ),
    listPilotDevices(),
    namesByEmail(viewer).catch(() => new Map<string, string>()),
  ]);

  const rows = mergeDeviceRows(site.ok ? site.value : [], pilot.ok ? pilot.value : [], names, new Date());
  return {
    rows,
    site: site.ok ? { ok: true as const } : { ok: false as const, message: 'The site’s device list could not be read.' },
    pilot: pilot.ok ? { ok: true as const } : { ok: false as const, message: pilotFailureText(pilot.reason) },
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
};
