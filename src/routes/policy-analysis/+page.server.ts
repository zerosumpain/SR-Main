import type { PageServerLoad } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { listAnalyses } from '$lib/policy-analysis/server/store';
import { CODEX_MODELS, DEFAULT_CODEX_MODEL_SLUG, toCodexModelId } from '$lib/server/models/codex-catalogue';
import { isCodexEnabled } from '$lib/server/models/settings';

/**
 * The model list is loaded here rather than fetched from
 * `/api/admin/models/codex`, which is what the chat pickers do.
 *
 * That endpoint probes the bridge on every call with a five-second timeout, and
 * this page is a form the reader fills in before committing to an hour of work —
 * it does not need a liveness check to render a dropdown. If the bridge is down
 * the submission still queues and the stage records a provider error it can be
 * resumed from, which is the behaviour every other failure here already has.
 *
 * A retired model is offered with its date rather than hidden: the reader may be
 * re-running an assessment against the same model as last time, and an option
 * that disappears without explanation is worse than one that says why to avoid it.
 */
/**
 * Whether a model can answer ONE page inside this feature's per-call deadline.
 *
 * Not a taste ranking — a measurement. Stage 1 makes one timed call per page,
 * and on 2026-09-10 a 72-page white paper commissioned on Sol died at page 5
 * because Sol needs longer than the deadline allows on an ordinary page of
 * dense prose. Timed against the real stage-1 prompt and the real pages:
 *
 *   ministerial foreword   luna 85s · terra 111s · sol >301s · astra 502 @ 237s
 *
 * A model nobody has timed says nothing, rather than guessing.
 */
const PACE: Record<string, string> = {
  'gpt-5.6-luna': 'comfortably inside the per-page limit',
  'gpt-5.6-terra': 'inside the per-page limit, with less room',
  'gpt-5.6-sol': 'too slow for a long document',
  'gpt-6-astra': 'too slow for a long document',
};

export const load: PageServerLoad = async (event) => {
  const owner = await requirePolicyOwner(event);
  const [analyses, codexEnabled] = await Promise.all([listAnalyses(owner), isCodexEnabled()]);
  return {
    analyses,
    enabled: process.env.POLICY_ANALYSIS_ENABLED !== '0',
    codexEnabled,
    defaultModelId: toCodexModelId(DEFAULT_CODEX_MODEL_SLUG),
    models: CODEX_MODELS.map((m) => ({
      id: toCodexModelId(m.slug),
      slug: m.slug,
      name: m.name,
      description: m.description,
      proOnly: m.proOnly ?? false,
      retiresOn: m.retiresOn ?? null,
      pace: PACE[m.slug] ?? null,
    })),
  };
};
