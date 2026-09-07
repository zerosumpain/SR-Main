import { Agent } from 'undici';
const workspaceDispatcher = new Agent({ headersTimeout: 1_800_000, bodyTimeout: 1_800_000 });
import { loadDelivery, mutateDelivery } from '$lib/jkai/development-state.server';
import { acceptanceBlocker } from '$lib/jkai/development';

/** Trusted workspace broker owns git snapshots, isolated previews and batch merges. */
export async function workspaceBroker(action: string, buildId: string, extra: Record<string, unknown> = {}) {
  const base = process.env.BUILDER_WORKSPACE_BROKER_URL;
  const token = process.env.BUILDER_WORKSPACE_BROKER_TOKEN;
  if (!base || !token) throw new Error('The isolated workspace broker is not configured on this host.');
  const response = await fetch(`${base}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ buildId, ...extra }), dispatcher: workspaceDispatcher, signal: AbortSignal.timeout(action === 'accept' ? 1_800_000 : 600_000),
  } as RequestInit & { dispatcher: Agent });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Workspace operation failed');
  return result as { revision: string; url: string; batch: string; detail?: string; changes?: { files: string[]; patch: string } };
}
export async function snapshotCandidate(buildId: string) {
  return workspaceBroker('snapshot', buildId);
}
export async function prepareDevelopmentPreview(buildId: string): Promise<void> {
  const delivery = await loadDelivery(buildId);
  if (!delivery?.state.candidate) throw new Error('No verified candidate to preview');
  const candidate = delivery.state.candidate;
  const isBatch = Boolean(delivery.state.acceptedAt && delivery.state.batch);
  const revision = isBatch ? delivery.state.batch! : candidate;
  const previewId = isBatch ? `batch-${buildId}` : buildId;
  await mutateDelivery(buildId, 'preview_starting', (s) => ({ ...s,
    preview: { url: null, status: 'starting', detail: 'Preparing an isolated site and synthetic database.' } }));
  let result;
  try { result = await workspaceBroker('preview', previewId, { revision }); }
  catch (error) {
    await mutateDelivery(buildId, 'preview_failed', (s) => s.candidate !== candidate ? s : ({ ...s, preview: { url: null, status: 'failed', detail: error instanceof Error ? error.message.slice(-2000) : 'Preview preparation failed.' } }));
    throw error;
  }
  await mutateDelivery(buildId, 'preview_ready', (s) => {
    if (s.candidate !== candidate || (isBatch && s.batch !== revision)) throw new Error('The candidate changed while preparing its preview.');
    return { ...s, preview: { url: result.url, status: 'ready', detail: result.detail ?? 'Isolated site with a separate database; live providers are not connected.' } };
  });
}
export async function acceptDevelopment(buildId: string, expectedRevision: number): Promise<void> {
  const delivery = await loadDelivery(buildId);
  if (!delivery || delivery.revision !== expectedRevision) throw new Error('The workspace changed; reload before accepting.');
  const blocker = acceptanceBlocker(delivery.state);
  if (blocker) throw new Error(blocker);
  // Broker serialises integration and independently checks the actual candidate.
  await mutateDelivery(buildId, 'integration_started', (s) => ({ ...s, stage: 'integrating' }), expectedRevision);
  let result;
  try { result = await workspaceBroker('accept', buildId, { revision: delivery.state.candidate }); }
  catch (error) {
    await mutateDelivery(buildId, 'integration_failed', (s) => ({ ...s, stage: 'review' }));
    throw error;
  }
  await mutateDelivery(buildId, 'batch_accepted', (s) => {
    if (s.candidate !== delivery.state.candidate || acceptanceBlocker(s)) throw new Error('Acceptance changed during batch integration; review again.');
    return { ...s, stage: 'accepted', batch: result.batch, preview: { ...s.preview, url: result.url, detail: 'Combined local batch preview; integration checks passed.' }, acceptedAt: new Date().toISOString() };
  });
}
