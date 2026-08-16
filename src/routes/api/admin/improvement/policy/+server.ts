import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPolicyVersions, publishPolicy, revertPolicyTo } from '$lib/toolpolicy/policy';
import { coerceOwnerPublish, needsHermesReconnect } from '$lib/toolpolicy/publish-input';
import { getTools } from '$lib/workflows/site-tools/registry';
import { measureEfficiency, snapshotOf } from '$lib/selfimprove/efficiency';
import { getActivePolicy } from '$lib/toolpolicy/policy';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). Manual control
// over the tool-call policy overlay. The engine reverts itself when a trial
// fails; this is the override for when the owner wants a version gone NOW
// rather than at the end of its trial.

/** GET — every stored version, newest first. */
export const GET: RequestHandler = async () => {
  return json({ versions: await listPolicyVersions(50) });
};

/**
 * POST { version: number } — roll back to `version` (0 = the base policy, i.e.
 * no overlay at all). Republishes that version's content as a new version, so
 * history stays append-only and the revert itself is auditable.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 0) {
    return json({ error: '`version` must be a non-negative integer (0 = no overlay)' }, { status: 400 });
  }
  const published = await revertPolicyTo(version, 'manual revert by owner', 'owner');
  if (!published) {
    return json({ error: `version ${version} not found` }, { status: 404 });
  }
  return json({ ok: true, active: published });
};

/**
 * PUT — publish a new overlay version ON TRIAL, authored by the owner.
 *
 * Body: { rationale, promoteToEssential?, overrides?, globalGuidance?, targetTool? }
 *
 * The engine could always publish; the owner could only revert. That left the
 * overlay's biggest lever unreachable: `promoteToEssential` lifts a tool out of
 * the `jkai_extended` dispatcher into direct visibility, which removes a whole
 * round trip per first use — and `optimise.ts` never emits one, because its
 * prompt asks for a rewritten DESCRIPTION, not a visibility change.
 *
 * Published exactly like an engine version: same collection, same immutable
 * `v:<n>` record, same trial, same automatic rollback if calls-per-turn does
 * not drop. The only difference is `createdBy: 'owner'`.
 *
 * Refuses while another trial is running. That is not politeness — two live
 * overlays make the metric unattributable, and an unattributable metric cannot
 * roll either of them back (see the one-experiment-at-a-time note in
 * `optimise.ts`).
 */
export const PUT: RequestHandler = async ({ request }) => {
  const parsed = coerceOwnerPublish(await request.json().catch(() => ({})), new Set(getTools().map((t) => t.name)));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  const current = await getActivePolicy();
  if (current.trial?.status === 'running') {
    return json({
      error:
        `v${current.version} is still on trial (${current.trial.turnsObserved} turns observed since ` +
        `${current.trial.startedAt}). Two live overlays make the metric unattributable. Wait for the nightly ` +
        `assessment, or revert v${current.version} first.`,
    }, { status: 409 });
  }

  // No measurement means no trial, and a version published with `trial: null`
  // would never be judged or rolled back — it would just sit there forever.
  const eff = await measureEfficiency();
  if (!eff) {
    return json({ error: 'Cannot baseline: the Hermes session store is unreachable, so this change could never be measured or rolled back.' }, { status: 503 });
  }

  try {
    const published = await publishPolicy({
      ...parsed.input,
      // A version is the FULL policy, not a patch — carry the live entries
      // forward or publishing silently reverts work a previous trial kept.
      overrides: { ...current.overrides, ...parsed.input.overrides },
      globalGuidance: [...current.globalGuidance, ...(parsed.input.globalGuidance ?? [])].slice(0, 6),
      promoteToEssential: [...new Set([...current.promoteToEssential, ...(parsed.input.promoteToEssential ?? [])])],
      baseline: snapshotOf(eff),
    });
    return json({
      ok: true,
      active: published,
      baseline: snapshotOf(eff),
      // The caller MUST act on this. Promotions and global guidance reach the
      // model only through the MCP manifest, which Hermes reads once on
      // connect — publish without restarting and the trial measures a change
      // the model never saw, then reverts it as "no effect".
      requiresHermesReconnect: needsHermesReconnect(parsed.input),
      ...(needsHermesReconnect(parsed.input)
        ? { action: 'Restart the Hermes gateway (`systemctl --user restart jkai-hermes`) before this can take effect.' }
        : {}),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'publish failed' }, { status: 500 });
  }
};
