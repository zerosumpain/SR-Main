/**
 * Owner-gated (hooks.server.ts — /api/jkai is owner-only). Backs the model
 * picker's Workloads tab: read what every LLM role on the site is actually
 * running, and point one at a different model.
 *
 * Two scopes behind one endpoint, because from the operator's side they are one
 * question ("what is running what?") even though the mechanisms differ:
 *   - `site`   → an `app_settings` row, live immediately;
 *   - `hermes` → a key in the engine's own config.yaml, applied by
 *                `hermes config set` plus a gateway restart.
 *
 * The Hermes leg shells out on homeserv (proxied from the VPS), so it is slower
 * and can be unavailable. It is therefore best-effort: a Hermes outage returns
 * the site rows plus an error string rather than failing the whole read, since
 * the site half is still true and still actionable.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveDefaultModel } from '$lib/server/models/settings';
import {
  describeSiteWorkloads,
  setWorkloadModel,
  workloadBlockReason,
} from '$lib/server/models/workload-settings';
import { getWorkload, type WorkloadState } from '$lib/models/workloads';

interface Picture {
  siteDefaultModelId: string;
  site: WorkloadState[];
}

async function picture(): Promise<Picture> {
  const [siteDefault, site] = await Promise.all([resolveDefaultModel(), describeSiteWorkloads()]);
  return { siteDefaultModelId: siteDefault.modelId, site };
}

export const GET: RequestHandler = async () => json(await picture());

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    workloadId?: unknown;
    modelId?: unknown;
  };

  const def = typeof body.workloadId === 'string' ? getWorkload(body.workloadId) : null;
  if (!def) throw error(400, 'unknown workload');

  const modelId = body.modelId === null ? null : body.modelId;
  if (modelId !== null && (typeof modelId !== 'string' || !modelId.includes('/'))) {
    // A bare slug would 400 at call time; refuse it at save time. Codex ids
    // pass because they carry the `codex/` prefix, which is itself a slash.
    throw error(400, 'invalid modelId — must be a full slug (vendor/model)');
  }

  if (modelId !== null) {
    const blocked = await workloadBlockReason(def, modelId);
    if (blocked) throw error(400, blocked);
  }
  await setWorkloadModel(def, modelId);
  return json({ ok: true, ...(await picture()) });
};
