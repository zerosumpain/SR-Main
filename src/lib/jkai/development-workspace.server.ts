import { DevelopmentFailure, DEVELOPMENT_LIMITS, developmentDeadline } from './development-cycle';
import { Agent } from 'undici';
const workspaceDispatcher = new Agent({ headersTimeout: 1_800_000, bodyTimeout: 1_800_000 });
import { loadDelivery, mutateDelivery } from '$lib/jkai/development-state.server';
import { acceptanceBlocker, candidateChanged } from '$lib/jkai/development';

/** Trusted workspace broker owns git snapshots, isolated previews and batch merges. */
export async function workspaceBroker(action: string, buildId: string, extra: Record<string, unknown> = {}) {
  const base = process.env.BUILDER_WORKSPACE_BROKER_URL;
  const token = process.env.BUILDER_WORKSPACE_BROKER_TOKEN;
  if (!base || !token) throw new DevelopmentFailure('The isolated workspace broker is not configured on this host.');
  const response = await fetch(`${base}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ buildId, ...extra }), dispatcher: workspaceDispatcher, signal: AbortSignal.timeout(action === 'preflight' ? DEVELOPMENT_LIMITS.preflightMs : ['accept', 'verify'].includes(action) ? 1_800_000 : 600_000),
  } as RequestInit & { dispatcher: Agent });
  const result = await response.json();
  if (!response.ok) throw new DevelopmentFailure(result.error ?? 'Workspace operation failed', ['feature', 'deadline'].includes(result.kind) ? result.kind : 'infrastructure');
  return result as { revision: string; url: string; batch: string; complete?: boolean; evidence?: string[]; detail?: string; timings?: Record<string, number>; changes?: { files: string[]; patch: string } };
}
export async function snapshotCandidate(buildId: string) {
  return workspaceBroker('snapshot', buildId);
}
/** Keep the last successful URL visible until its replacement has actually passed. */
export async function prepareDevelopmentPreview(buildId: string, mode: 'inspection' | 'working' | 'release' = 'inspection'): Promise<boolean> {
  const delivery = await loadDelivery(buildId);
  if (!delivery?.state.candidate) throw new Error('No saved candidate to preview');
  const candidate = delivery.state.candidate;
  const isBatch = Boolean(delivery.state.acceptedAt && delivery.state.batch);
  const revision = isBatch ? delivery.state.batch! : candidate;
  const previewId = isBatch ? `batch-${buildId}` : buildId;
  const previous = delivery.state.preview;
  await mutateDelivery(buildId, 'preview_starting', s => ({ ...s,
    preview: { ...s.preview, status: 'starting', lastError: undefined, detail: previous.url ? 'Checking the next revision; the previous working preview remains available.' : 'Preparing the first working page in an isolated site.' } }));
  const started = Date.now();
  let result;
  try { result = await workspaceBroker(mode === 'release' ? 'verify' : 'preview', previewId, { revision, routes: delivery.state.brief.routes, working: mode !== 'inspection', ...(mode !== 'inspection' && delivery.state.cycle ? { deadline: developmentDeadline(delivery.state.cycle.startedAt, Boolean(previous.url && ['working', 'release'].includes(previous.kind ?? ''))) } : {}) }); }
  catch (error) {
    await mutateDelivery(buildId, 'preview_failed', s => s.candidate !== candidate ? s : ({ ...s,
      cycle: s.cycle ? { ...s.cycle, previewMs: s.cycle.previewMs + (mode !== 'release' ? Date.now() - started : 0), verificationMs: s.cycle.verificationMs + (mode === 'release' ? Date.now() - started : 0) } : undefined,
      preview: { ...previous, status: previous.url ? 'ready' : 'failed', lastError: error instanceof Error ? error.message.slice(-2000) : 'Preview preparation failed.', detail: previous.url ? 'The next revision failed its checks. The previous working preview remains available.' : 'The first working preview has not passed its checks yet.' } }));
    throw error;
  }
  await mutateDelivery(buildId, 'checkpoint_timing', s => !s.cycle ? s : ({ ...s, cycle: { ...s.cycle, firstPreviewAt: mode === 'inspection' ? s.cycle.firstPreviewAt : s.cycle.firstPreviewAt ?? new Date().toISOString(), phaseMs: Object.fromEntries([...new Set([...Object.keys(s.cycle.phaseMs ?? {}), ...Object.keys(result.timings ?? {})])].map(key => [key, (s.cycle!.phaseMs?.[key] ?? 0) + (result.timings?.[key] ?? 0)])), previewMs: s.cycle.previewMs + (mode !== 'release' ? Date.now() - started : 0), verificationMs: s.cycle.verificationMs + (mode === 'release' ? Date.now() - started : 0) } }));
  await mutateDelivery(buildId, mode === 'release' ? 'release_candidate_ready' : 'preview_ready', s => {
    if (s.candidate !== candidate || (isBatch && s.batch !== revision)) throw new Error('The candidate changed while preparing its preview.');
    return { ...s, preview: { url: result.url, status: 'ready', revision, kind: mode === 'release' ? 'working' : mode === 'inspection' && s.gate?.passed && s.gate.revision === candidate ? 'release' : mode, number: (previous.number ?? 0) + (previous.revision === revision ? 0 : 1), evidence: result.evidence,
      detail: result.detail ?? 'Isolated site with a separate database; live providers are not connected.' } };
  });
  return result.complete === true;
}

/** Called only between model turns, after all writes have settled. */
export async function developmentCheckpoint(buildId: string, verify: (run: () => Promise<boolean>) => Promise<boolean>) {
  const snapshot = await snapshotCandidate(buildId);
  await mutateDelivery(buildId, 'working_candidate', s => ({ ...candidateChanged(s, snapshot.revision), changes: snapshot.changes, stage: 'building' }));
  const complete = await prepareDevelopmentPreview(buildId, 'working');
  if (!complete) return false;
  if (!await verify(() => prepareDevelopmentPreview(buildId, 'release'))) throw new Error('Release verification did not confirm a completed brief.');
  await mutateDelivery(buildId, 'candidate_verified', s => {
    if (s.candidate !== snapshot.revision) throw new Error('Candidate changed during isolated verification.');
    return { ...s, cycle: s.cycle ? { ...s.cycle, candidateAt: new Date().toISOString() } : undefined, stage: 'review', preview: { ...s.preview, kind: 'release' }, gate: { passed: true, revision: snapshot.revision, evidence: 'Isolated structural, type, repository test, production build, release sidecar and feature browser checks passed.' } };
  });
  return true;
}
export async function acceptDevelopment(buildId: string, expectedRevision: number): Promise<void> {
  const delivery = await loadDelivery(buildId);
  if (!delivery || delivery.revision !== expectedRevision) throw new Error('The workspace changed; reload before accepting.');
  const blocker = acceptanceBlocker(delivery.state);
  if (blocker) throw new Error(blocker);
  // Broker serialises integration and independently checks the actual candidate.
  await mutateDelivery(buildId, 'integration_started', (s) => ({ ...s, stage: 'integrating' }), expectedRevision);
  let result;
  try { result = await workspaceBroker('accept', buildId, { revision: delivery.state.candidate, routes: delivery.state.brief.routes }); }
  catch (error) {
    await mutateDelivery(buildId, 'integration_failed', (s) => ({ ...s, stage: 'review' }));
    throw error;
  }
  await mutateDelivery(buildId, 'batch_accepted', (s) => {
    if (s.candidate !== delivery.state.candidate || acceptanceBlocker(s)) throw new Error('Acceptance changed during batch integration; review again.');
    return { ...s, stage: 'accepted', batch: result.batch, preview: { ...s.preview, url: result.url, detail: 'Combined local batch preview; integration checks passed.' }, acceptedAt: new Date().toISOString() };
  });
}
