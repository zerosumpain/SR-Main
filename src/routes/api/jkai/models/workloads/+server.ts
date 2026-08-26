/**
 * Owner-gated (hooks.server.ts — /api/jkai is owner-only). Backs the model
 * picker's Workloads tab: read what every LLM role on the site is actually
 * running, and point one at a different model.
 *
 * Every role is an `app_settings` row and takes effect immediately. This once
 * spanned two scopes with different mechanisms — the second belonged to an
 * external runtime with its own config file, and could be unreachable — which
 * is why the shape still reads as a "picture" assembled per request.
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
