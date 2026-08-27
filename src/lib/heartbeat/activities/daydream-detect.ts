import { getSetting } from '$lib/server/models/settings';
import { buildSnapshot } from '$lib/daydream/snapshot';
import { DETECTORS } from '$lib/daydream/detectors';
import { persistCandidates, wakeSnoozed } from '$lib/daydream/thought-store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { Candidate, Readiness } from '$lib/daydream/snapshot-types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-detect';

interface DetectConfig {
  /** Detectors to skip entirely, by kind. An operator lever, distinct from
   *  the owner's `never this kind` mute, which lives in app_settings. */
  disabledKinds?: string[];
}

const DEFAULTS: Required<DetectConfig> = { disabledKinds: [] };

/**
 * The thinking half of daydreaming — and it does not think in the way the name
 * suggests.
 *
 * The pure detectors run over one snapshot. Each declares what it needs
 * before it may speak at all, and returns nothing below that. No LLM is
 * involved and none may be: the model's job comes later, phrasing a finding
 * that a rule already confirmed.
 *
 * Nothing here notifies anyone. Candidates land in `daydream_thoughts`,
 * including the ones scored below the delivery threshold — those are written
 * `suppressed` with the reason, so the ledger can show what it nearly said.
 * Delivery is merge 4, deliberately after the page exists, so there is real
 * feedback to calibrate the threshold against before anything buzzes.
 */
export const daydreamDetect: ActivityHandler = {
  name: NAME,
  description:
    'Runs the daydream detectors over one snapshot every 10 minutes and writes what they find to the ledger. Each detector declares a minimum support and stays silent below it. No LLM, no notifications.',
  defaultCadenceSeconds: 600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as DetectConfig) };
    let errorsLoadingRules: string | null = null;

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const runId = `dd-${ctx.now}`;
    const snapshot = await buildSnapshot({ now: new Date(ctx.now) });

    // Model-authored rules are loaded HERE and pushed into the detector, so the
    // detector layer stays a pure function over a snapshot. Putting the query
    // inside it would put I/O in the one layer whose whole value is having none.
    let activeRuleCount = 0;
    try {
      const { listActiveRules } = await import('$lib/daydream/rules/store');
      const { setActiveRules } = await import('$lib/daydream/detectors/rule-driven');
      const rules = await listActiveRules();
      setActiveRules(rules.map((r) => r.spec));
      activeRuleCount = rules.length;
    } catch (err) {
      // A rule table that cannot be read costs the model-authored rules, never
      // the hand-written ones.
      errorsLoadingRules = errMsg(err);
    }

    const woken = await wakeSnoozed(snapshot.now);

    const candidates: Candidate[] = [];
    const readiness: Record<string, Readiness> = {};
    const errors: string[] = [];
    let notReadyCount = 0;

    for (const detector of DETECTORS) {
      if (cfg.disabledKinds.includes(detector.kind)) continue;
      try {
        const r = detector.readiness(snapshot);
        readiness[detector.kind] = r;
        if (!r.ready) {
          notReadyCount++;
          continue;
        }
        candidates.push(...detector.detect(snapshot));
      } catch (err) {
        // One broken detector must not take the other seven down with it.
        errors.push(`${detector.kind}: ${errMsg(err)}`);
      }
    }

    const persisted = await persistCandidates(candidates, { runId, now: snapshot.now });

    const failedSources = snapshot.sources.filter((s) => s.status === 'failed');

    const summary =
      candidates.length === 0
        ? `nothing to say — ${notReadyCount}/${DETECTORS.length} detectors still gathering support`
        : `${candidates.length} candidates: +${persisted.created} new, ${persisted.updated} updated, ` +
          `${persisted.suppressed} below threshold`;

    return {
      outcome: errors.length ? 'error' : 'ok',
      summary: (errors.length ? `${errors.length} detector error(s); ` : '') + summary,
      details: {
        runId,
        activeRules: activeRuleCount,
        errorsLoadingRules,
        candidates: candidates.length,
        ...persisted,
        woken,
        notReady: notReadyCount,
        readiness,
        coverage: snapshot.coverage,
        trailSpanDays: snapshot.trailSpanDays,
        sources: snapshot.sources,
        failedSources: failedSources.map((s) => `${s.key}: ${s.detail}`),
        errors,
      },
    };
  },
};
