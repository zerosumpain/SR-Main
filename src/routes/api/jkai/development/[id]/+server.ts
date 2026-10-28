import { developmentProgress } from '$lib/builds/development-progress.server';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadDelivery, deliveryEvents } from '$lib/jkai/development-state.server';
import { areaLessons } from '$lib/codegraph/build-lessons.server';
import { instructionHistory } from '$lib/jkai/pending-messages';
import { listNotes } from '$lib/jkai/build-notes';
import { acceptanceBlocker } from '$lib/jkai/development';
import { runDevelopmentAction } from '$lib/jkai/development-actions.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const delivery = await loadDelivery(params.id);
  if (!delivery) throw error(404, 'Development workspace not found');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  return json({ delivery, build, progress: await developmentProgress(params.id), instructions: await instructionHistory(params.id), notes: await listNotes(params.id),
    events: await deliveryEvents(params.id), lessons: await areaLessons(delivery.state.area), blocker: acceptanceBlocker(delivery.state) });
};
/** The owner's web page: every action (`$lib/jkai/development-actions.server`). */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null);
  return runDevelopmentAction(params.id, body);
};
