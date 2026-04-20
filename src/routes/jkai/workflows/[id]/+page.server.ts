import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

// /jkai/workflows/:id → /jkai/canvas/:slug
// The canvas migration renames every workflow to `canvas:<slug>`, so
// we look up the workflow by id, pull its slug out of the name, and
// redirect. Requests for workflows that no longer exist 404.
export const load: PageServerLoad = async ({ params }) => {
  const [workflow] = await db
    .select({ name: workflows.name })
    .from(workflows)
    .where(eq(workflows.id, params.id))
    .limit(1);
  if (!workflow) throw error(404, 'Workflow not found');

  const slug = workflow.name.startsWith('canvas:')
    ? workflow.name.slice('canvas:'.length)
    : params.id; // pre-migration fallback — canvas/[slug] accepts ids too
  throw redirect(308, `/jkai/canvas/${slug}`);
};
