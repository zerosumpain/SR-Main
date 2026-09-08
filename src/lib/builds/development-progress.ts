import { criterionResult } from '$lib/jkai/development';
import type { DeliveryState } from '$lib/constants/development';
import type { RepoVerificationEvent, RepoVerificationPhase } from '$lib/verification/repo';
import type { Tone } from '$lib/daydream/priority';
export type IterationProgress = { id: string; number: number; status: string; goals: string | null; evaluation: string | null;
  nextSteps: string | null; tokensUsed: number; outputTokens: number; durationMs: number | null; createdAt: string | Date };
export type DevelopmentProgress = { totalTokens: number; outputTokens: number; iterations: IterationProgress[]; verification?: Partial<Record<RepoVerificationPhase, RepoVerificationEvent>>; stage?: { stage: string; message?: string; iteration?: number } | null; testFailure?: { content: string; createdAt: string | Date } | null };
export function outputBudget(used: number, limit?: number) {
  return limit && limit > 0 ? { used, limit, percent: Math.min(100, Math.max(0, used / limit * 100)) } : null;
}
export function evidencedCriteria(criteria: Array<{ verdict: string; revision: string | null; assessment?: DeliveryState['criteria'][number]['assessment'] }>, candidate: string | null) {
  return candidate ? criteria.filter(c => criterionResult(c, candidate).verdict === 'passed').length : 0;
}

/** Assess observable delivery state, independently of the worker's terminal status. */
export function developmentPosition(progress: DevelopmentProgress, state: DeliveryState, build: { status: string; outcome?: string | null }) {
  const checks = Object.values(progress.verification ?? {});
  const failed = checks.some(check => ['failed', 'reused_failed'].includes(check.status));
  const checking = build.status === 'running' && (progress.stage?.stage === 'running_tests' || checks.some(check => check.status === 'running'));
  const stopped = build.outcome === 'stopped_by_user' || (build.status === 'completed' && progress.stage?.message === 'Stopped by user');
  const verified = !!state.candidate && state.gate?.passed === true && state.gate.revision === state.candidate;
  const ready = !!state.preview.url && ['ready', 'starting'].includes(state.preview.status);
  const busy = ['running', 'queued'].includes(build.status);
  const work = progress.iterations.some(i => i.tokensUsed > 0) || !!state.candidate;
  const working = ready && state.preview.kind === 'working';
  const inspection = ready && !verified && !working;
  const label = state.acceptedAt ? 'Accepted into batch' : state.decisions.some(d => !d.answer) ? 'Your decision is needed' : ready ? working ? `Working preview ${state.preview.number ?? 1}${busy ? ' · iterating' : ' available'}` : inspection ? 'Inspection preview available' : 'Release candidate ready for review' : state.preview.status === 'starting' ? 'Preparing isolated preview' : stopped ? 'Stopped · no verified delivery' : checking ? 'Checking the implementation' : failed ? busy ? 'Working through failed checks' : 'Blocked by repository checks' : build.status === 'failed' ? 'Build failed · review the evidence' : busy ? 'Implementation in progress' : 'No verified preview yet';
  return { label, failed, checking, stopped, verified, ready, inspection, working, busy, work,
    canInspect: work && !busy && !state.acceptedAt && state.preview.status !== 'starting',
    checksLabel: verified ? 'Passed' : checking ? 'Running' : failed ? 'Failed' : 'Not verified',
    previewReason: state.preview.status === 'failed' ? state.preview.detail : failed ? 'Repository checks failed. Inspect saved work before commissioning more iterations.' : busy ? 'The worker is building the first useful page. A working preview will appear automatically after its browser checks pass.' : 'No verified candidate has been prepared. An inspection preview does not approve this work.',
  };
}
export function assessmentExcerpt(text: string | null, limit = 650) {
  return (text ?? '').split('\n\nWorkspace state after this iteration:')[0].replace(/^#+\s*Evaluation\s*/i, '').trim().slice(0, limit);
}

/** Preserve preview access grants while opening the feature's own local route. */
export function featurePreviewUrl(base: string | null, route: string): string | null {
  if (!base) return null;
  try {
    const origin = new URL(base); const target = new URL(route || '/', origin);
    if (!['http:', 'https:'].includes(origin.protocol)) return null;
    if (!route.startsWith('/') || route.startsWith('//') || target.origin !== origin.origin) return base;
    for (const [key, value] of origin.searchParams) target.searchParams.set(key, value);
    return target.toString();
  } catch { return null; }
}

/**
 * Which column of the portfolio a delivery belongs in.
 *
 * One function rather than a filter expression per surface: the list page's
 * lane tabs and the workspace's own reading of "where am I" must agree, and
 * two copies of this ladder is how a build ends up counted under Building and
 * displayed under Review.
 */
export type DevelopmentLane = 'brief' | 'building' | 'input' | 'review' | 'accepted';
export function developmentLane(state: DeliveryState): DevelopmentLane {
  if (state.acceptedAt || state.stage === 'accepted' || state.stage === 'integrating') return 'accepted';
  if (state.decisions.some((d) => !d.answer)) return 'input';
  if (state.candidate || state.stage === 'review') return 'review';
  if (!state.brief.acceptedAt) return 'brief';
  return 'building';
}

/**
 * The hub's six tones, from the stage word the page actually prints.
 *
 * The daydream hub's rule applies here too: never hand-write a `t-*` class
 * from a database word. `visibleDevelopmentStage` is the only producer of
 * these strings, so this is the one place the two vocabularies meet.
 */
export function developmentTone(visibleStage: string): Tone {
  const stage = visibleStage.toLowerCase();
  if (stage === 'failed' || stage === 'stopped' || stage.startsWith('ended without')) return 'urgent';
  if (stage === 'needs input') return 'action';
  if (stage === 'paused') return 'watch';
  if (stage === 'accepted' || stage === 'deployed') return 'good';
  if (stage === 'brief') return 'quiet';
  return 'steady';
}
