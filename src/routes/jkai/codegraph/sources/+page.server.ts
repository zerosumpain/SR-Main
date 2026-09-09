import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { codegraphSources, codegraphSnapshots } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { registerSource } from '$lib/codegraph/sources.server';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async () => ({
  sources: await db.select().from(codegraphSources).orderBy(desc(codegraphSources.createdAt)).limit(100),
  snapshots: await db.select({ repo: codegraphSnapshots.repo, revision: codegraphSnapshots.revision, scope: codegraphSnapshots.scope, createdAt: codegraphSnapshots.createdAt }).from(codegraphSnapshots).orderBy(desc(codegraphSnapshots.createdAt)).limit(30),
});
export const actions: Actions = { default: async ({ request }) => {
  try { return { saved: await registerSource(Object.fromEntries(await request.formData())) }; }
  catch (e) { return fail(400, { error: e instanceof Error ? e.message : 'Invalid source' }); }
} };
