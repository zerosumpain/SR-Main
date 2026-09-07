import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiBuildLessons } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadDelivery, mutateDelivery, deliveryEvents, relevantLessons } from '$lib/jkai/development-state.server';
import { instructionHistory, enqueuePendingMessage } from '$lib/jkai/pending-messages';
import { listNotes, addNote, removeNote } from '$lib/jkai/build-notes';
import { builderClient } from '$lib/jkai/builder-client';
import { acceptDevelopment, prepareDevelopmentPreview, workspaceBroker } from '$lib/jkai/development-workspace.server';
import { PRODUCT_AREAS, acceptanceBlocker } from '$lib/jkai/development';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const delivery = await loadDelivery(params.id);
  if (!delivery) throw error(404, 'Development workspace not found');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  return json({ delivery, build, instructions: await instructionHistory(params.id), notes: await listNotes(params.id),
    events: await deliveryEvents(params.id), lessons: await relevantLessons(delivery.state.area), blocker: acceptanceBlocker(delivery.state) });
};
function text(value: unknown, limit = 5000): string {
  if (typeof value !== 'string' || value.length > limit) throw error(400, `Expected text up to ${limit} characters`);
  return value.trim();
}
export const POST: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') throw error(400, 'Action required');
  const delivery = await loadDelivery(id);
  if (!delivery) throw error(404, 'Development workspace not found');
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision !== delivery.revision) return json({ error: 'The workspace changed; refresh before saving.' }, { status: 409 });
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id));
  try {
    if (delivery.state.stage === 'integrating' && body.action !== 'accept') throw new Error('Batch integration is in progress.');
    switch (body.action) {
      case 'brief': {
        if (body.briefRevision !== delivery.state.brief.revision) throw new Error('The brief changed in another session; reload before editing.');
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before changing its accepted brief. You can send a steering instruction while it runs.');
        const outcome = text(body.outcome, 20000);
        const constraints = text(body.constraints);
        const criteria = text(body.criteria).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30);
        const routes = text(body.routes).split('\n').map((s) => s.trim()).filter(Boolean);
        if (!outcome || !criteria.length || routes.some((r) => !r.startsWith('/') || r.startsWith('//'))) throw new Error('Provide an outcome, acceptance criteria and valid local route paths.');
        if (!PRODUCT_AREAS.includes(body.area)) throw new Error('Choose a product area');
        await mutateDelivery(id, 'brief_accepted', (s) => ({ ...s, area: body.area, stage: 'brief', acceptedAt: null, batch: null, gate: null, preview: { url: null, status: 'unavailable', detail: 'The brief changed; build and verify it again.' },
          brief: { revision: s.brief.revision + 1, outcome, constraints, routes, acceptedAt: new Date().toISOString() },
          criteria: criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text, verdict: 'unverified', evidence: '', revision: null })) }), revision);
        await db.update(jkaiBuilds).set({ prompt: outcome }).where(eq(jkaiBuilds.id, id));
        break;
      }
      case 'start':
      case 'resume': {
        if (!delivery.state.brief.acceptedAt) throw new Error('Accept the brief before building.');
        if (delivery.state.decisions.some((d) => !d.answer)) throw new Error('Answer the pending decisions first.');
        if (['running', 'queued'].includes(build.status)) throw new Error('This build is already active.');
        await mutateDelivery(id, 'build_requested', (s) => ({ ...s, stage: 'queued', acceptedAt: null, batch: null }), revision);
        try {
          if (delivery.state.session.id) await builderClient.restartBuild(id);
          else await builderClient.startBuild(id);
        } catch (e) {
          await mutateDelivery(id, 'worker_unavailable', (s) => ({ ...s, stage: 'brief' }));
          throw e;
        }
        break;
      }
      case 'pause': await builderClient.pauseBuild(id); break;
      case 'stop': await builderClient.stopBuild(id); break;
      case 'steer': {
        const content = text(body.content);
        if (!content) throw new Error('Enter an instruction');
        await enqueuePendingMessage(id, content);
        break;
      }
      case 'note': await addNote(id, text(body.content)); break;
      case 'remove_note': await removeNote(id, Number(body.noteId)); break;
      case 'decision': {
        const question = text(body.question);
        if (!question) throw new Error('Enter a question');
        await mutateDelivery(id, 'decision_requested', (s) => ({ ...s, stage: 'needs_input', decisions: [...s.decisions, { id: crypto.randomUUID(), question, answer: null }] }), revision);
        if (build.status === 'running') await builderClient.pauseBuild(id);
        break;
      }
      case 'answer': {
        const answer = text(body.answer);
        const decision = delivery.state.decisions.find((d) => d.id === body.decisionId);
        if (decision?.answer) throw new Error('This decision has already been answered; reload to see it.');
        if (!decision || !answer) throw new Error('Choose a pending decision and supply an answer.');
        await mutateDelivery(id, 'decision_answered', (s) => ({ ...s, decisions: s.decisions.map((d) => d.id === decision.id ? { ...d, answer } : d) }), revision);
        await builderClient.sessionAnswer(id, decision.id).catch(() => {});
        await enqueuePendingMessage(id, `Owner decision: ${decision.question}\n${answer}`);
        break;
      }
      case 'criterion': {
        if (delivery.state.acceptedAt) throw new Error('Start a new revision before changing evidence for accepted work.');
        if (body.candidate !== delivery.state.candidate) throw new Error('The candidate changed; review the new preview.');
        if (!delivery.state.candidate) throw new Error('There is no candidate to evaluate.');
        if (!['passed', 'failed', 'blocked', 'unverified'].includes(body.verdict)) throw new Error('Invalid verdict');
        const evidence = text(body.evidence);
        if (!evidence && body.verdict !== 'unverified') throw new Error('Describe the evidence or blocker');
        if (!delivery.state.criteria.some((c) => c.id === body.criterionId)) throw new Error('Criterion not found');
        await mutateDelivery(id, 'criterion_reviewed', (s) => ({ ...s, acceptedAt: null, criteria: s.criteria.map((c) => c.id === body.criterionId ?
          { ...c, verdict: body.verdict, evidence, revision: s.candidate } : c) }), revision);
        break;
      }
      case 'close_preview':
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before closing its preview.');
        await mutateDelivery(id, 'preview_closed', (s) => ({ ...s, preview: { url: null, status: 'unavailable', detail: 'Preview closed. Source and session are retained.' } }), revision);
        await workspaceBroker('close-preview', id, { batch: Boolean(delivery.state.batch) });
        break;
      case 'preview':
        if (['running', 'queued'].includes(build.status)) throw new Error('Wait for a verified candidate before preparing a preview.');
        await prepareDevelopmentPreview(id); break;
      case 'accept':
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause implementation before accepting a candidate.');
        await acceptDevelopment(id, revision); break;
      case 'lesson': {
        if (!delivery.state.acceptedAt || !delivery.state.candidate) throw new Error('Repository lessons need an accepted, evidenced candidate.');
        const lesson = text(body.lesson); const evidence = text(body.evidence);
        if (!lesson || !evidence) throw new Error('Supply a lesson and its evidence.');
        await db.insert(jkaiBuildLessons).values({ buildId: id, area: delivery.state.area, lesson, evidence,
          revision: delivery.state.candidate, expiresAt: new Date(Date.now() + 90 * 86400000) });
        break;
      }
      default: throw new Error('Unknown action');
    }
    return json({ ok: true });
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'The operation failed' }, { status: 400 }); }
};
