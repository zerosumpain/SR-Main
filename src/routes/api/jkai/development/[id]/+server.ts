import { resolveDevelopmentModel } from '$lib/jkai/development-models.server';
import { developmentProgress } from '$lib/builds/development-progress.server';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiBuildLessons } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadDelivery, mutateDelivery, deliveryEvents, relevantLessons } from '$lib/jkai/development-state.server';
import { instructionHistory, enqueuePendingMessage } from '$lib/jkai/pending-messages';
import { listNotes, addNote, removeNote } from '$lib/jkai/build-notes';
import { builderClient } from '$lib/jkai/builder-client';
import { acceptDevelopment, prepareDevelopmentPreview, workspaceBroker } from '$lib/jkai/development-workspace.server';
import { AUTOPILOT_ROUNDS, PRODUCT_AREAS, RELEASE_POLICIES, acceptanceBlocker, inspectionCandidate, releaseBlocker } from '$lib/jkai/development';
import type { ReleasePolicy } from '$lib/jkai/development';
import { groomDevelopmentBrief, readBriefFields } from '$lib/jkai/development-grooming.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const delivery = await loadDelivery(params.id);
  if (!delivery) throw error(404, 'Development workspace not found');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  return json({ delivery, build, progress: await developmentProgress(params.id), instructions: await instructionHistory(params.id), notes: await listNotes(params.id),
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
  // Two kinds of write, and only one of them can afford an optimistic lock over
  // the WHOLE workspace. Recording a verdict or adding a request touches one
  // field of one criterion and carries its own guards — while an unattended run
  // is going, the worker writes every few seconds, so a workspace-wide revision
  // check meant the owner's own observations were refused as "the workspace
  // changed" almost every time they pressed the button.
  const SCOPED = ['criterion', 'request', 'note', 'remove_note', 'steer'];
  if (!SCOPED.includes(body.action) && (!Number.isInteger(revision) || revision !== delivery.revision)) {
    return json({ error: 'The workspace changed; refresh before saving.' }, { status: 409 });
  }
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id));
  try {
    if (delivery.state.stage === 'integrating' && body.action !== 'accept') throw new Error('Batch integration is in progress.');
    if (delivery.state.preview.status === 'starting' && !['steer', 'pause', 'stop', 'note'].includes(body.action)) throw new Error('Preview preparation is in progress. Wait for its result before changing this workspace.');
    switch (body.action) {
      case 'groom': {
        if (['running', 'queued'].includes(build.status) || delivery.state.brief.acceptedAt) throw new Error('Grooming is available for draft briefs. Pause and edit an accepted brief explicitly.');
        if (body.briefRevision !== delivery.state.brief.revision) throw new Error('The brief changed; reload before refining.');
        if (!PRODUCT_AREAS.includes(body.area)) throw new Error('Choose a product area');
        const model = body.modelId === undefined || body.modelId === build.modelId ? { provider: build.modelProvider, modelId: build.modelId } : await resolveDevelopmentModel(body.modelId);
        const draft = readBriefFields(body);
        const message = text(body.message ?? '', 5000);
        const turns = delivery.state.grooming?.turns ?? [];
        const proposal = await groomDevelopmentBrief({ ...draft, area: body.area }, message, await relevantLessons(body.area), turns);
        await mutateDelivery(id, 'brief_groomed', (s) => ({ ...s, originalAsk: s.originalAsk ?? build.prompt, area: body.area,
          brief: { ...proposal.brief, revision: s.brief.revision + 1, acceptedAt: null },
          criteria: proposal.criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text, verdict: 'unverified', evidence: '', revision: null })),
          grooming: { ...proposal.grooming, turns: [...turns, ...(message ? [{ questions: draft.questions, answer: message }] : [])].slice(-12) },
        }), revision, { modelProvider: model.provider, modelId: model.modelId });
        break;
      }
      case 'brief': {
        if (body.briefRevision !== delivery.state.brief.revision) throw new Error('The brief changed in another session; reload before editing.');
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before changing its accepted brief. You can send a steering instruction while it runs.');
        const extra = readBriefFields(body);
        const outcome = text(body.outcome, 20000);
        const constraints = text(body.constraints, 20000);
        const criteria = text(body.criteria, 30000).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30);
        const routes = text(body.routes).split('\n').map((s) => s.trim()).filter(Boolean);
        if (!outcome || !criteria.length || routes.some((r) => !r.startsWith('/') || r.startsWith('//'))) throw new Error('Provide an outcome, acceptance criteria and valid local route paths.');
        if (!PRODUCT_AREAS.includes(body.area)) throw new Error('Choose a product area');
        const model = body.modelId === undefined || body.modelId === build.modelId ? { provider: build.modelProvider, modelId: build.modelId } : await resolveDevelopmentModel(body.modelId);
        await mutateDelivery(id, 'brief_accepted', (s) => ({ ...s, originalAsk: s.originalAsk ?? build.prompt, area: body.area, stage: 'brief', acceptedAt: null, batch: null, gate: null, preview: { url: null, status: 'unavailable', detail: 'The brief changed; build and verify it again.' },
          brief: { ...extra, revision: s.brief.revision + 1, outcome, constraints, routes, acceptedAt: new Date().toISOString() },
          criteria: criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text, verdict: 'unverified', evidence: '', revision: null })) }), revision, { prompt: outcome, modelProvider: model.provider, modelId: model.modelId });
        break;
      }
      case 'start':
      case 'resume': {
        const capabilities = await builderClient.developmentCapabilities().catch(() => null);
        if (!capabilities?.persistentSessions || !capabilities.brokerConfigured) throw new Error('The development worker is not ready. An updated worker waiting for an active build will become available when that build finishes.');
        if (!delivery.state.brief.acceptedAt) throw new Error('Accept the brief before building.');
        if (delivery.state.decisions.some((d) => !d.answer)) throw new Error('Answer the pending decisions first.');
        if (['running', 'queued'].includes(build.status)) throw new Error('This build is already active.');
        await mutateDelivery(id, 'build_requested', (s) => ({ ...s, stage: 'queued', acceptedAt: null, batch: null, cycle: { startedAt: new Date().toISOString(), modelId: build.modelId ?? undefined, startingCandidate: s.candidate, repairAttempts: 0, modelMs: 0, previewMs: 0, verificationMs: 0 } }), revision);
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
        // Clearing the stage matters as much as saving the answer: `needs_input`
        // is what the portfolio's Needs-you lane reads, and nothing else moved
        // it, so an answered feature sat in that column until the next start.
        await mutateDelivery(id, 'decision_answered', (s) => {
          const decisions = s.decisions.map((d) => d.id === decision.id ? { ...d, answer, answeredBy: 'owner' as const } : d);
          return { ...s, decisions, stage: s.stage === 'needs_input' && decisions.every((d) => d.answer) ? (s.candidate ? 'review' : 'building') : s.stage };
        }, revision);
        await builderClient.sessionAnswer(id, decision.id).catch(() => {});
        await enqueuePendingMessage(id, `Owner decision: ${decision.question}\n${answer}`);
        break;
      }
      case 'criterion': {
        // A verdict is a judgement about the revision the owner actually looked
        // at, which is the one the preview is serving — not necessarily the
        // newest candidate. Those two diverge constantly by design: a working
        // preview is deliberately retained while the next revision is checked.
        // Recording against the preview's revision is what makes the judgement
        // true, and `criterionResult` already ignores a verdict once the
        // candidate has moved past it, so nothing stale can leak into
        // acceptance.
        if (delivery.state.acceptedAt) throw new Error('Start a new revision before changing evidence for accepted work.');
        const judged = typeof body.judgedRevision === 'string' && body.judgedRevision
          ? body.judgedRevision
          : delivery.state.preview.revision ?? delivery.state.candidate;
        if (!judged) throw new Error('There is nothing to judge yet — build a preview first.');
        if (judged !== delivery.state.preview.revision && judged !== delivery.state.candidate) throw new Error('That revision is no longer in this workspace; reload and look at the current preview.');
        if (!['passed', 'failed', 'blocked', 'unverified'].includes(body.verdict)) throw new Error('Invalid verdict');
        const evidence = text(body.evidence);
        if (!evidence && body.verdict !== 'unverified') throw new Error('Describe the evidence or blocker');
        if (!delivery.state.criteria.some((c) => c.id === body.criterionId)) throw new Error('Criterion not found');
        // The reviewer's assessment is KEPT. It is what the run thought, and the
        // owner reads it beside their own verdict; `criterionResult` gives the
        // owner precedence without either one erasing the other.
        await mutateDelivery(id, 'criterion_reviewed', (s) => ({ ...s, criteria: s.criteria.map((c) => c.id === body.criterionId ?
          { ...c, verdict: body.verdict, evidence, revision: judged } : c) }));
        break;
      }
      case 'request': {
        // A follow-up ask becomes an acceptance criterion, because that is the
        // only thing in this system that actually holds a build to something:
        // an unmet criterion blocks acceptance and is what the next coaching
        // instruction is built from. Anything else would be a note nobody reads.
        if (!delivery.state.brief.acceptedAt) throw new Error('Accept the brief first; then anything you add here becomes part of what this feature must do.');
        const request = text(body.request, 1000);
        if (!request) throw new Error('Describe what else you want from this feature.');
        if (delivery.state.criteria.length >= 30) throw new Error('This feature already has thirty acceptance criteria. Commission a second feature instead.');
        const saved = await mutateDelivery(id, 'feature_requested', (s) => ({ ...s, acceptedAt: null,
          criteria: [...s.criteria, { id: `criterion-${s.criteria.length + 1}-${Date.now().toString(36)}`, text: request, verdict: 'unverified' as const, evidence: '', revision: null, addedBy: 'owner' as const }] }));
        await enqueuePendingMessage(id, `The owner has added an acceptance criterion to this feature. It is now part of what must be true before the work can be accepted:\n${request}`);
        return json({ ok: true, criteria: saved.state.criteria.length });
      }
      case 'close_preview':
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before closing its preview.');
        await mutateDelivery(id, 'preview_closed', (s) => ({ ...s, preview: { url: null, status: 'unavailable', detail: 'Preview closed. Source and session are retained.' } }), revision);
        await workspaceBroker('close-preview', id, { batch: Boolean(delivery.state.batch) });
        break;
      case 'inspect_preview': {
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before preparing an inspection preview.');
        if (!delivery.state.brief.acceptedAt || delivery.state.acceptedAt) throw new Error('Inspection needs an accepted brief that has not joined the batch.');
        const progress = await developmentProgress(id);
        if (!progress.iterations.some(i => i.tokensUsed > 0) && !delivery.state.candidate) throw new Error('No saved implementation to inspect yet.');
        await mutateDelivery(id, 'inspection_requested', s => ({ ...s, preview: { ...s.preview, status: 'starting', detail: 'Snapshotting saved work for inspection; acceptance remains blocked.' } }), revision);
        try {
          const result = await workspaceBroker('snapshot', id);
          await mutateDelivery(id, 'inspection_snapshot', s => inspectionCandidate(s, result.revision, result.changes));
          await prepareDevelopmentPreview(id);
        } catch (e) {
          await mutateDelivery(id, 'inspection_failed', s => ({ ...s, preview: { ...delivery.state.preview, status: delivery.state.preview.url ? 'ready' : 'failed', lastError: e instanceof Error ? e.message.slice(-2000) : 'Inspection preview failed.', detail: 'Inspection failed; any previous working preview is retained.' } }));
          throw e;
        }
        break;
      }
      case 'preview':
        if (['running', 'queued'].includes(build.status)) throw new Error('Wait for a verified candidate before preparing a preview.');
        await prepareDevelopmentPreview(id); break;
      case 'continue': {
        const { continueDevelopment } = await import('$lib/jkai/development-review.server');
        return json({ ok: true, next: await continueDevelopment(id, revision) });
      }
      case 'autopilot': {
        // Turning it on clears a previous stop reason and its round counter:
        // this is the owner saying "go again", not a resume of the run that
        // already gave up.
        const on = body.enabled === true;
        if (on && !delivery.state.brief.acceptedAt) throw new Error('Accept the brief before starting an autonomous run.');
        const maxRounds = Math.min(AUTOPILOT_ROUNDS.max, Math.max(1, Math.round(Number(body.maxRounds) || AUTOPILOT_ROUNDS.default)));
        await mutateDelivery(id, on ? 'autopilot_started' : 'autopilot_paused', (s) => ({ ...s,
          autopilot: on
            ? { enabled: true, rounds: 0, maxRounds, startedAt: new Date().toISOString() }
            : s.autopilot ? { ...s.autopilot, enabled: false, stopReason: 'Stopped by you.' } : undefined }), revision);
        break;
      }
      case 'release_policy': {
        const policy = body.policy as ReleasePolicy;
        if (!RELEASE_POLICIES.includes(policy)) throw new Error('Choose where this feature should stop.');
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before changing where it stops.');
        await mutateDelivery(id, 'release_policy_set', (s) => ({ ...s, releasePolicy: policy }), revision);
        break;
      }
      case 'release': {
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before releasing its candidate.');
        const blocker = releaseBlocker(delivery.state);
        if (blocker) throw new Error(blocker);
        const { releaseDevelopment } = await import('$lib/jkai/development-release.server');
        return json({ ok: true, release: await releaseDevelopment(id, revision) });
      }
      case 'reset_batch': {
        // The recovery for a wedged batch. Stated plainly rather than hidden
        // behind a retry: any feature accepted but not yet released has to be
        // accepted again afterwards.
        if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before rebuilding the batch.');
        await workspaceBroker('reset-batch', id);
        await mutateDelivery(id, 'batch_reset', (s) => ({ ...s, batch: null, acceptedAt: s.release?.prUrl ? s.acceptedAt : null,
          stage: s.stage === 'accepted' && !s.release?.prUrl ? 'review' : s.stage }), revision);
        break;
      }
      case 'release_check': {
        const { watchDevelopmentRelease } = await import('$lib/jkai/development-release.server');
        return json({ ok: true, next: await watchDevelopmentRelease(id) });
      }
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
