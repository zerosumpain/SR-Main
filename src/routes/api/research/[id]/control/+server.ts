/**
 * Pause, resume, or stop a research run.
 *
 * Three verbs, and the difference between them is what happens to the work:
 *
 *  - **pause** — halt and keep your place. The phase is recorded, in-flight
 *    leads go back on the queue, and the row lands in a status the resume sweep
 *    deliberately ignores, so a deploy will not silently restart it.
 *  - **resume** — pick up at the recorded phase. Never at phase 1, unless phase
 *    1 is genuinely where it stopped.
 *  - **stop** — wind down and write the report from what has been gathered. This
 *    is the existing behaviour, and it is terminal.
 *
 * Owner-gated by the hook: nothing under /api/research is on the public list.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, researchLeads } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requestPause, requestStop, isRunning } from '$lib/deepdive/worker';
import { resumeSession } from '$lib/deepdive/resume';
import { resumePhase } from '$lib/deepdive/phase-order';

const TERMINAL = ['complete', 'failed'];

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === 'string' ? body.action : '';

  const [session] = await db
    .select({
      id: researchSessions.id,
      status: researchSessions.status,
      depth: researchSessions.depth,
      resumeFrom: researchSessions.resumeFrom,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'No such research run.' }, { status: 404 });

  if (action === 'pause') {
    if (session.status === 'paused') return json({ ok: true, status: 'paused' });
    if (TERMINAL.includes(session.status)) {
      return json({ error: 'This run has already finished.' }, { status: 409 });
    }

    /**
     * A worker in THIS process gets asked nicely: pause is cooperative, so the
     * lead in its hand finishes and the phase records itself on the way out.
     *
     * A run whose worker died with a deploy has nobody to ask. Its row still
     * says `phase2` and the sweep would adopt it on the next boot, so pausing
     * it means writing the paused row here — otherwise the button would appear
     * to do nothing and the run would restart itself an hour later.
     */
    if (isRunning(params.id)) {
      // Only the phase chain checks the pause flag. A budgeted tier runs to a
      // clock inside one bounded call, so accepting a pause it will ignore
      // would leave the page reporting a state that is not true.
      if (session.depth !== 'investigation') {
        return json(
          { error: 'A run this short cannot be paused — stop it instead, and it will report what it has.' },
          { status: 409 },
        );
      }
      requestPause(params.id);
      return json({ ok: true, status: 'pausing' });
    }

    const phase = resumePhase(session);
    await db
      .update(researchLeads)
      .set({ status: 'queued', startedAt: null })
      .where(and(eq(researchLeads.sessionId, params.id), eq(researchLeads.status, 'running')));
    await db
      .update(researchSessions)
      .set({ status: 'paused', resumeFrom: phase, heartbeatAt: null })
      .where(eq(researchSessions.id, params.id));
    return json({ ok: true, status: 'paused', phase, note: 'No worker was running — parked in place.' });
  }

  if (action === 'resume') {
    if (session.status === 'complete') {
      return json({ error: 'This run already finished.' }, { status: 409 });
    }
    const outcome = await resumeSession(params.id);
    if (!outcome.ok) return json({ error: outcome.reason ?? 'Could not resume.' }, { status: 409 });
    return json({ ok: true, status: outcome.phase, phase: outcome.phase });
  }

  if (action === 'stop') {
    if (TERMINAL.includes(session.status)) {
      return json({ error: 'This run has already finished.' }, { status: 409 });
    }
    requestStop(params.id);
    return json({ ok: true, status: 'stopping' });
  }

  return json({ error: `Unknown action "${action}". Use pause, resume or stop.` }, { status: 400 });
};
