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
import { rHermesModels, rSetHermesModel, canManageHermes } from '$lib/server/hermes-remote';
import { getWorkload, HERMES_WORKLOADS, type WorkloadState } from '$lib/models/workloads';

interface Picture {
  siteDefaultModelId: string;
  site: WorkloadState[];
  hermes: WorkloadState[];
  /** Null when the engine answered; a message when it did not. */
  hermesError: string | null;
  hermesManageable: boolean;
}

async function picture(): Promise<Picture> {
  const [siteDefault, site] = await Promise.all([resolveDefaultModel(), describeSiteWorkloads()]);

  let hermes: WorkloadState[] = [];
  let hermesError: string | null = null;

  if (canManageHermes()) {
    try {
      const rows = await rHermesModels();
      hermes = HERMES_WORKLOADS.map((def) => {
        const row = rows.find((r) => r.id === def.id);
        const effectiveModelId = row?.modelId ?? '—';
        return {
          id: def.id,
          scope: def.scope,
          label: def.label,
          blurb: def.blurb,
          key: def.key,
          reason: def.reason,
          requires: def.requires,
          catalogue: def.catalogue,
          setModelId: row?.modelId ?? null,
          effectiveModelId,
          // Always 'hermes': every one of these values is read from the
          // engine's config, never inherited from the site default. That is
          // precisely the fact this tab exists to make visible.
          source: 'hermes' as const,
          divergesFromDefault: effectiveModelId !== siteDefault.modelId,
        };
      });
    } catch (err) {
      hermesError = err instanceof Error ? err.message : String(err);
    }
  } else {
    hermesError = 'Hermes is not reachable from this host.';
  }

  return {
    siteDefaultModelId: siteDefault.modelId,
    site,
    hermes,
    hermesError,
    hermesManageable: canManageHermes(),
  };
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

  if (def.scope === 'hermes') {
    // Hermes has no "unset" that means anything useful: clearing model.default
    // does not hand the engine back to the site default, it leaves it with no
    // model. So a clear is refused rather than silently doing something else.
    if (modelId === null) throw error(400, `${def.label} cannot be cleared — pick a model instead.`);
    const blocked = await workloadBlockReason(def, modelId);
    if (blocked) throw error(400, blocked);

    const result = await rSetHermesModel(def.id, modelId);
    if (!result.ok) {
      throw error(502, `Hermes rejected the change: ${result.stderr.trim() || 'unknown error'}`);
    }
    return json({ ok: true, ...(await picture()) });
  }

  if (modelId !== null) {
    const blocked = await workloadBlockReason(def, modelId);
    if (blocked) throw error(400, blocked);
  }
  await setWorkloadModel(def, modelId);
  return json({ ok: true, ...(await picture()) });
};
