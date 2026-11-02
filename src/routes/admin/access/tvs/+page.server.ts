import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { GameError } from '$lib/games/tap-duel';
import { approveLink, listTvs, renameTv, revokeTv } from '$lib/games/tv-devices.server';

/**
 * /admin/access/tvs — the TVs allowed to host a family games party (sr. tv).
 * Owner only (the /admin gate). Linking: the TV shows four letters at
 * /games/tv; type them here with a name and it is linked at once.
 */
export const load: PageServerLoad = async () => ({ tvs: await listTvs() });

async function attempt(fn: () => Promise<unknown>, values: Record<string, string> = {}) {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof GameError) return fail(err.status, { error: err.message, ...values });
    throw err;
  }
}

export const actions: Actions = {
  link: async ({ request }) => {
    const form = await request.formData();
    const code = String(form.get('code') ?? '');
    const name = String(form.get('name') ?? '');
    return attempt(() => approveLink(code, name), { code, name });
  },
  rename: async ({ request }) => {
    const form = await request.formData();
    return attempt(() => renameTv(String(form.get('id') ?? ''), form.get('name')));
  },
  revoke: async ({ request }) => {
    const form = await request.formData();
    return attempt(() => revokeTv(String(form.get('id') ?? '')));
  },
};
