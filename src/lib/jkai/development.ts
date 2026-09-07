import { PRODUCT_AREAS, type DeliveryState } from '$lib/constants/development';
export { PRODUCT_AREAS };
export type { DeliveryState, DeliveryStage, Criterion } from '$lib/constants/development';

export function newDelivery(outcome: string, area = 'Platform', criteria: string[] = []): DeliveryState {
  return {
    version: 1, area, stage: 'brief',
    brief: { revision: 1, outcome, constraints: '', routes: [], acceptedAt: null },
    criteria: criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text, verdict: 'unverified', evidence: '', revision: null })),
    decisions: [], session: { engine: 'pi', id: null, file: null, recovery: null },
    candidate: null, gate: null,
    preview: { url: null, status: 'unavailable', detail: 'A preview has not been prepared.' },
    batch: null, acceptedAt: null, releasePolicy: 'preview_only',
  };
}
export function acceptanceBlocker(state: DeliveryState): string | null {
  if (!state.brief.acceptedAt) return 'Accept the current brief first.';
  if (state.decisions.some((d) => !d.answer)) return 'Answer the pending decisions first.';
  if (!state.candidate || !state.gate?.passed || state.gate.revision !== state.candidate) return 'The current candidate needs a passing repository gate.';
  if (state.preview.status !== 'ready') return 'Prepare and try the site preview first.';
  if (!state.criteria.length) return 'Add at least one acceptance criterion.';
  if (state.criteria.some((c) => c.verdict !== 'passed' || !c.evidence.trim() || c.revision !== state.candidate)) return 'Every criterion needs passing evidence for this candidate.';
  return null;
}
export function candidateChanged(state: DeliveryState, revision: string): DeliveryState {
  if (state.candidate === revision) return state;
  return { ...state, candidate: revision, gate: null, acceptedAt: null, batch: null,
    criteria: state.criteria.map((c) => ({ ...c, verdict: 'unverified', revision: null })),
    preview: { url: null, status: 'unavailable', detail: 'The candidate changed; prepare a fresh preview.' } };
}
export function deliveryPrompt(state: DeliveryState): string {
  return ['Accepted product brief (revision ' + state.brief.revision + '):', state.brief.outcome,
    'Constraints: ' + state.brief.constraints, 'Target routes: ' + state.brief.routes.join(', '),
    'Acceptance criteria:', ...state.criteria.map((c) => `- ${c.text}`),
    'Owner decisions:', ...state.decisions.filter((d) => d.answer).map((d) => `${d.question}: ${d.answer}`),
    'Prepare the change for local preview. Do not push, create a PR, merge or deploy.',
    'On continuation, inspect git status and unfinished commands before acting. Do not repeat external side effects from the transcript.',
  ].join('\n');
}

/** Product review stages remain distinct from worker liveness. */
export function visibleDevelopmentStage(state: DeliveryState, workerStatus: string): string {
  if (state.stage === 'integrating' || state.stage === 'accepted') return state.stage;
  if (state.decisions.some((d) => !d.answer)) return 'needs input';
  if (workerStatus === 'failed' || workerStatus === 'stopped') return workerStatus;
  if (workerStatus === 'queued') return 'queued';
  if (workerStatus === 'paused' && state.stage === 'building') return 'paused';
  return state.stage.replaceAll('_', ' ');
}
