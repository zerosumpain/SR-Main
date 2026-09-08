/**
 * The unattended loop: brief in, pull request out, nobody watching.
 *
 * Everything it does was already possible by hand. `Continue automatically`
 * assessed the criteria and either accepted the candidate or fed the worker
 * back its gaps — but only when the owner pressed it, and the run stopped dead
 * after every working preview. Autopilot is the driver that presses it, plus
 * the two things a person was doing that no code did: answering the worker's
 * questions from the brief, and taking an accepted candidate the rest of the
 * way to a serving commit.
 *
 * WHERE THIS RUNS. In the builder sidecar, off the orchestrator's own timer.
 * That process already owns build state, holds the controller advisory lock so
 * only one of it exists, and survives a web deploy. A driver in the web app
 * would be racing itself across two workers; a driver in the browser would need
 * the page left open.
 *
 * WHAT IT WILL NOT DO. It cannot merge — CI does that, and only for a
 * `tier=low` `agent/` pull request. It cannot answer a question the brief does
 * not settle; it escalates and stops. It cannot run past its round cap, its
 * budget or its per-turn deadlines. And it does nothing at all unless the owner
 * chose it when commissioning the feature.
 */
import { db } from '$lib/db';
import { jkaiBuilds, jkaiBuildDeliveries } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getLLMClient } from '$lib/llm/client';
import { coerceModelContext } from '$lib/constants/default-models';
import { withActivity } from '$lib/context/activity';
import { notifyAllSubscribers } from '$lib/server/push';
import { loadDelivery, mutateDelivery } from './development-state.server';
import { autopilotActive, type DeliveryState } from './development';
import { emitLog } from './log-emitter';

export type AutopilotOutcome = 'idle' | 'started' | 'assessed' | 'building' | 'released' | 'shipped' | 'stopped';

/** A round is one assessment and whatever it led to. */
const ESCALATE = 'ESCALATE';

const DECISION_SYSTEM = `You answer a coding agent's question on behalf of a site owner who is away, using ONLY the accepted brief supplied to you.
Answer in one or two sentences, decisively, when the brief's outcome, scope, constraints or assumptions settle the question — including when they settle it by implication and a reasonable person would read it the same way.
Reply with exactly ESCALATE and nothing else when answering would change the agreed scope, spend money, touch production data, contact anyone, weaken a security or privacy control, or pick between options the brief genuinely does not choose between. Never invent a preference the brief does not support, and never approve an irreversible action.`;

/**
 * Answer a blocking question from the brief, or escalate.
 *
 * Deliberately given the brief and nothing else: the whole value is that the
 * answer is traceable to something the owner accepted. A model with the wider
 * site in context would start inventing preferences.
 */
export async function answerFromBrief(state: DeliveryState, question: string, model: { provider?: string; modelId: string }): Promise<string | null> {
  const { client, model: resolved } = await getLLMClient(coerceModelContext(model));
  const response = await withActivity('selfimprove', () => client.chat.completions.create({
    model: resolved, temperature: 0.1, max_tokens: 400,
    messages: [
      { role: 'system', content: DECISION_SYSTEM },
      { role: 'user', content: JSON.stringify({ brief: state.brief, area: state.area, question }) },
    ],
  }, { timeout: 45000, maxRetries: 0 }));
  const answer = (response.choices?.[0]?.message?.content ?? '').trim();
  if (!answer || answer.toUpperCase().startsWith(ESCALATE)) return null;
  return answer.slice(0, 2000);
}

async function stop(buildId: string, reason: string, notify = true): Promise<'stopped'> {
  await mutateDelivery(buildId, 'autopilot_stopped', s => ({ ...s, autopilot: s.autopilot ? { ...s.autopilot, stopReason: reason } : s.autopilot }));
  await emitLog(buildId, 'system', `Autopilot stopped: ${reason}`);
  if (notify) {
    await notifyAllSubscribers({ title: 'Autopilot needs you', body: reason.slice(0, 140), url: `/jkai/develop/${buildId}` })
      .catch((error) => console.warn('[autopilot] push failed', error));
  }
  return 'stopped';
}

/**
 * One step for one feature. Safe to call repeatedly; it decides what is next
 * from the saved state rather than from anything it remembers.
 */
export async function autopilotStep(buildId: string): Promise<AutopilotOutcome> {
  const delivery = await loadDelivery(buildId);
  if (!delivery) return 'idle';
  const state = delivery.state;
  if (!state.autopilot?.enabled || state.autopilot.stopReason) return 'idle';

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) return 'idle';
  // The worker is mid-turn. Nothing to drive; the checkpoint will pause it.
  if (['running', 'queued'].includes(build.status)) return 'idle';
  if (state.stage === 'integrating' || state.preview.status === 'starting') return 'idle';

  // Already shipped: the only work left is confirming it is serving.
  if (state.stage === 'pr_open' || state.stage === 'deployed') {
    const { watchDevelopmentRelease } = await import('./development-release.server');
    const result = await watchDevelopmentRelease(buildId).catch(() => 'pending' as const);
    if (result === 'deployed') {
      await mutateDelivery(buildId, 'autopilot_complete', s => ({ ...s, autopilot: s.autopilot ? { ...s.autopilot, stopReason: 'The feature is merged and serving in production.' } : s.autopilot }));
      await notifyAllSubscribers({ title: 'Shipped', body: build.title ?? 'A development feature is live', url: `/jkai/develop/${buildId}` }).catch(() => {});
      return 'shipped';
    }
    if (result === 'closed') return stop(buildId, 'The pull request was closed without merging.');
    return 'idle';
  }

  if (!autopilotActive(state)) return stop(buildId, `Autopilot reached its limit of ${state.autopilot.maxRounds} rounds. The saved work, preview and evidence are retained.`);
  if (!state.brief.acceptedAt) return stop(buildId, 'The brief has not been accepted, so there is nothing to build.');

  // A blocking question. Answer it from the brief, or hand it back.
  const pendingDecision = state.decisions.find(d => !d.answer);
  if (pendingDecision) {
    // The reviewer answers, not the builder. A decision is a judgement about
    // the brief, and letting the model that raised the question also settle it
    // is the same self-service this whole loop exists to remove.
    const { developmentAssessor } = await import('./development-review.server');
    const assessor = await developmentAssessor(build.modelId);
    const answer = await answerFromBrief(state, pendingDecision.question, assessor).catch(() => null);
    if (!answer) return stop(buildId, `A decision needs you: ${pendingDecision.question.slice(0, 180)}`);
    const { builderClient } = await import('./builder-client');
    const { enqueuePendingMessage } = await import('./pending-messages');
    await mutateDelivery(buildId, 'decision_answered', s => {
      const decisions = s.decisions.map(d => d.id === pendingDecision.id ? { ...d, answer, answeredBy: 'autopilot' as const, answeredAt: new Date().toISOString() } : d);
      return { ...s, decisions, stage: s.stage === 'needs_input' && decisions.every(d => d.answer) ? (s.candidate ? 'review' : 'building') : s.stage };
    }, delivery.revision);
    await builderClient.sessionAnswer(buildId, pendingDecision.id).catch(() => {});
    await enqueuePendingMessage(buildId, `Owner decision, answered from the accepted brief by autopilot: ${pendingDecision.question}\n${answer}`);
    await emitLog(buildId, 'system', `Autopilot answered from the brief: ${pendingDecision.question.slice(0, 160)}`);
    return 'assessed';
  }

  const readyForReview = Boolean(state.candidate) && state.preview.status === 'ready' && state.preview.revision === state.candidate && !state.acceptedAt;
  const acceptedAwaitingRelease = Boolean(state.acceptedAt) && state.releasePolicy !== 'preview_only' && !state.release?.prUrl;

  try {
    if (acceptedAwaitingRelease) {
      const { releaseDevelopment } = await import('./development-release.server');
      await releaseDevelopment(buildId, delivery.revision);
      return 'released';
    }
    if (readyForReview) {
      const { continueDevelopment } = await import('./development-review.server');
      // Use the revision the mutation actually returned. Assuming `+ 1` throws
      // away a whole round the moment anything else writes to this workspace
      // between the two calls — the page's own 3-second poll is a writer.
      const counted = await mutateDelivery(buildId, 'autopilot_round', s => ({ ...s, autopilot: s.autopilot ? { ...s.autopilot, rounds: s.autopilot.rounds + 1, lastRoundAt: new Date().toISOString() } : s.autopilot }));
      const next = await continueDevelopment(buildId, counted.revision);
      return next === 'released' ? 'released' : next === 'accepted' ? 'assessed' : next === 'blocked' ? 'idle' : 'building';
    }
    // Paused with no reviewable candidate: the last turn failed its checks or
    // changed nothing. Restart the worker with whatever the cycle recorded.
    const { builderClient } = await import('./builder-client');
    const capabilities = await builderClient.developmentCapabilities().catch(() => null);
    if (!capabilities?.persistentSessions || !capabilities.brokerConfigured) return stop(buildId, 'The development worker is not available.');
    await mutateDelivery(buildId, 'autopilot_round', s => ({ ...s, stage: 'queued', autopilot: s.autopilot ? { ...s.autopilot, rounds: s.autopilot.rounds + 1, lastRoundAt: new Date().toISOString() } : s.autopilot, cycle: {
      startedAt: new Date().toISOString(), modelId: build.modelId ?? undefined, startingCandidate: s.candidate, repairAttempts: 0, modelMs: 0, previewMs: 0, verificationMs: 0,
    } }), delivery.revision);
    if (state.session.id) await builderClient.restartBuild(buildId);
    else await builderClient.startBuild(buildId);
    return state.session.id ? 'building' : 'started';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Autopilot could not take the next step.';
    return stop(buildId, message.slice(0, 400));
  }
}

/**
 * Drive every feature whose autopilot is on and whose worker is idle.
 *
 * Serial on purpose. The orchestrator runs one build at a time anyway, and a
 * fan-out here would queue several builds against a single worker and a broker
 * whose preview pool is eight slots wide.
 */
export async function autopilotSweep(): Promise<void> {
  const rows = await db.select({ buildId: jkaiBuildDeliveries.buildId, state: jkaiBuildDeliveries.state, status: jkaiBuilds.status })
    .from(jkaiBuildDeliveries)
    .innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
    .where(and(inArray(jkaiBuilds.status, ['paused', 'failed', 'completed'])));
  for (const row of rows) {
    const pilot = row.state?.autopilot;
    if (!pilot?.enabled || pilot.stopReason) continue;
    try { await autopilotStep(row.buildId); }
    catch (error) { console.error(`[autopilot] ${row.buildId} step failed:`, error); }
  }
}
