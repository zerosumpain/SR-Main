/**
 * Client-side writes for "what model runs this?".
 *
 * Two controls on /admin/ops/costs now change a model — the per-role switcher
 * and the one-click Apply on a swap suggestion — and both must report the
 * endpoint's own refusal REASON rather than a status code: a text-only model
 * refused for a vision role explains itself, and swallowing that leaves the
 * operator staring at "save failed (400)" with no idea which rule they hit.
 *
 * These are the existing guarded endpoints, not new ones. There is still
 * exactly one server-side guard on a model change for the whole site; this
 * module only stops the two callers drifting apart on error handling.
 */

/** Point one site workload at a model, or pass null to clear the pin. */
export async function saveWorkloadModel(
  workloadId: string,
  modelId: string | null,
): Promise<void> {
  await post('/api/jkai/models/workloads', { workloadId, modelId });
}

/** Change the site default — what every unpinned role inherits. */
export async function saveSiteDefaultModel(modelId: string): Promise<void> {
  await post('/api/admin/models/settings', { chatDefaultModelId: modelId });
}

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => null)) as { message?: string } | null;
  throw new Error(payload?.message ?? `save failed (${res.status})`);
}
