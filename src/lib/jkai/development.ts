import { PRODUCT_AREAS, type DeliveryState } from '$lib/constants/development';
export { PRODUCT_AREAS };
export type { DeliveryState, DeliveryStage, Criterion } from '$lib/constants/development';

export function newDelivery(outcome: string, area = 'Platform', criteria: string[] = []): DeliveryState {
  return {
    version: 1, originalAsk: outcome, area, stage: 'brief',
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
  if (state.preview.status !== 'ready' || (state.preview.revision && state.preview.revision !== state.candidate)) return 'Prepare and try the site preview first.';
  if (!state.criteria.length) return 'Add at least one acceptance criterion.';
  if (state.criteria.some((c) => c.verdict !== 'passed' || !c.evidence.trim() || c.revision !== state.candidate)) return 'Every criterion needs passing evidence for this candidate.';
  return null;
}
export function candidateChanged(state: DeliveryState, revision: string): DeliveryState {
  if (state.candidate === revision) return state;
  return { ...state, candidate: revision, gate: null, acceptedAt: null, batch: null,
    criteria: state.criteria.map((c) => ({ ...c, verdict: 'unverified', revision: null })),
    preview: state.preview.url ? { ...state.preview, revision: state.preview.revision ?? state.candidate ?? undefined, detail: 'Previous working preview retained while the next revision is checked.' } : { url: null, status: 'unavailable', detail: 'The candidate changed; prepare a fresh preview.' } };
}
export function deliveryPrompt(state: DeliveryState): string {
  return ['Accepted product brief (revision ' + state.brief.revision + '):', state.brief.outcome,
    'Constraints: ' + state.brief.constraints, 'Target routes: ' + state.brief.routes.join(', '),
    'Scope: ' + (state.brief.scope ?? ''), 'Dependencies to verify: ' + (state.brief.dependencies ?? ''),
    'Assumptions: ' + (state.brief.assumptions ?? ''), 'Validation plan: ' + (state.brief.validation ?? ''),
    'Remaining questions to resolve during implementation: ' + (state.brief.questions ?? ''),
    'Use the agreed scope and assumptions for reversible implementation choices. Ask the owner if a remaining question blocks the feature or requires changing scope or taking an irreversible action.',
    'Acceptance criteria:', ...state.criteria.map((c) => `- ${c.text}`),
    'Owner decisions:', ...state.decisions.filter((d) => d.answer).map((d) => `${d.question}: ${d.answer}`),
    'End each model turn within five minutes. Aim for a browser-checked first page within ten minutes and a verified candidate within twenty minutes of starting. The worker enforces checkpoints and retains saved work when it pauses.',
    'FIRST MILESTONE: implement the smallest useful working page at the target route, with meaningful content and one core interaction. End this iteration as soon as that slice is ready so the broker can build and open it. Do not attempt the whole brief before the first preview.',
    'Create .development-preview.json in the repository root. Example: {"complete":false,"scenarios":[{"route":"/example","text":"Example heading","steps":[{"action":"click","role":"button","name":"Save"},{"action":"text","text":"Saved"}]}]}. Use the real target route, accessible control names and visible results. Supported actions: click, fill/select (with value), text and reload. Check a visible outcome after an interaction. Clearly label sample data and unavailable integrations in the page.',
    'The broker automatically runs these browser scenarios at desktop and phone widths and keeps the last successful snapshot visible while you continue. After the first preview, implement one useful increment per iteration and update the scenarios. Keep complete:false until the entire brief is implemented; then set complete:true to request full isolated repository verification and release-candidate review. A model completion claim alone is not verification.',
    'The broker runs repository gates in an isolated container that supports Bubblewrap. Do not weaken isolation tests or worker restrictions, or spend iterations retrying namespace-dependent repository gates inside the restricted worker. Use focused checks while implementing; report infrastructure failures.',
    state.preview.url ? `Working preview revision: ${state.preview.revision ?? 'legacy'}; ${state.preview.detail}` : 'No working preview yet: prioritize the first runnable slice.',
    state.preview.lastError ? `Last preview/check failure to address: ${state.preview.lastError}` : '',
    'Prepare the change for local preview. Do not push, create a PR, merge or deploy.',
    'On continuation, inspect git status and unfinished commands before acting. Do not repeat external side effects from the transcript.',
  ].join('\n');
}

/** Product review stages remain distinct from worker liveness. */
export function visibleDevelopmentStage(state: DeliveryState, workerStatus: string, outcome?: string | null): string {
  if (outcome === 'stopped_by_user') return 'stopped';
  if (workerStatus === 'completed' && !state.acceptedAt && !state.candidate) return 'ended without a candidate';
  if (state.stage === 'integrating' || state.stage === 'accepted') return state.stage;
  if (state.decisions.some((d) => !d.answer)) return 'needs input';
  if (workerStatus === 'failed' || workerStatus === 'stopped') return workerStatus;
  if (workerStatus === 'queued') return 'queued';
  if (workerStatus === 'paused' && state.stage === 'building') return 'paused';
  return state.stage.replaceAll('_', ' ');
}

/** Inspection keeps acceptance locked even when the isolated site can start. */
export function inspectionCandidate(state: DeliveryState, revision: string, changes?: { files: string[]; patch: string }): DeliveryState {
  return { ...candidateChanged(state, revision), stage: 'review', changes, acceptedAt: null, batch: null,
    preview: { ...candidateChanged(state, revision).preview, status: 'starting', detail: 'Preparing an unverified inspection snapshot.' },
    gate: { passed: false, revision, evidence: 'Inspection snapshot only. Repository checks have not passed for this candidate.' },
    criteria: state.criteria.map(c => ({ ...c, verdict: 'unverified', revision: null })),
  };
}
