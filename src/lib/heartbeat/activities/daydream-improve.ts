// src/lib/heartbeat/activities/daydream-improve.ts
//
// The self-improvement engine, running on the heartbeat instead of its own
// croner.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// Until now the site ran two idle-cycle schedulers. Daydreaming had the
// heartbeat — per-activity cadence, active-hours windows that reschedule to
// the next opening rather than locking out, quota attribution on every pulse,
// outcome dots and a failure budget. Self-improvement had a private `croner`
// in `$lib/selfimprove/engine.ts` with its own host gate, its own kill switch
// and its own idle gate, none of which anything else could see.
//
// The second scheduler had no advantage left, so it goes. What arrives here is
// only the SCHEDULING: `runImprovementNow` is unchanged, still writes one
// `improvement_runs` record per night, and both ledgers keep reading it.
//
// ── Why one activity and not four ───────────────────────────────────────────
//
// The eight phases share a budget, a run record and a wall-clock slot. Their
// `maxWallMs` of 25 minutes is not a guess — it is the gap between the 03:30
// start and the 04:00 model-routing job (see `$lib/selfimprove/types.ts`), and
// every phase already self-limits against `timeLeftMs()`. Splitting them into
// four heartbeat rows would fragment the run record that `narrative.ts`,
// `/jkai/daydreams?tab=improvement` and `/admin/ai/improvement` all read, and buy nothing:
// the point of the merge is to have one scheduler, not to re-cut the phases.

import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { runImprovementNow, isUserActive } from '$lib/selfimprove/run';
import { SETTINGS_ENABLED_KEY, errMsg, type RunStatus } from '$lib/selfimprove/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-improve';

interface ImproveConfig {
  /**
   * Run on `homeserv` too. Off by default, mirroring the host gate the croner
   * had: homeserv points at the dev database, and a run there would author
   * tools into it and burn LLM calls for nothing. The env override
   * `SELF_IMPROVE_ALLOW_DEV=1` still works and is checked as well, so an
   * existing dev workflow keeps behaving the way it documented itself.
   */
  allowDevHost?: boolean;
}

const DEFAULTS: Required<ImproveConfig> = { allowDevHost: false };

/** A run status that means the night produced nothing and should be visible as
 *  a failure on the pulse, rather than a quiet 'ok'. */
const FAILED_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['failed']);

export const daydreamImprove: ActivityHandler = {
  name: NAME,
  description:
    'The self-improvement run: learns from recent questions, grows the API catalogue, authors and repairs runtime tools behind verify.ts, trials one tool-call policy overlay, and opens draft PRs for anything needing repo code. One improvement_runs record per night. Skips when the owner has been active in the last hour.',
  // Daily. The window below is what actually decides when it lands; the cadence
  // only stops it running twice in one night.
  defaultCadenceSeconds: 86_400,
  defaultEnabled: true,
  // 02:30–03:55 Europe/London. The old croner fired at 03:30 and the run is
  // capped at 25 minutes, so it had to finish before the 04:00 model-routing
  // job. Opening at 02:30 keeps that guarantee with an hour to spare, and the
  // window closes at 03:55 so a late start can never begin a run that would
  // collide.
  defaultActiveHours: { start: '02:30', end: '03:55', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ImproveConfig) };

    // Host gate, carried over from the croner unchanged.
    if (
      os.hostname() === 'homeserv' &&
      !cfg.allowDevHost &&
      process.env.SELF_IMPROVE_ALLOW_DEV !== '1'
    ) {
      return { outcome: 'skipped', summary: 'host is homeserv — self-improvement runs on prod only' };
    }

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'kill switch is off' };
    }

    // The idle gate. `runImprovementNow` re-checks this itself for a 'cron'
    // trigger and would record an `aborted_user_active` run, but checking here
    // too keeps a quiet night out of the ledger entirely — the same shape the
    // croner had.
    if (await isUserActive()) {
      return { outcome: 'skipped', summary: 'owner active in the last hour' };
    }

    let runId: string;
    let data;
    try {
      ({ runId, data } = await runImprovementNow({ trigger: 'cron' }));
    } catch (err) {
      // The overlap guard throws when a manual "Run now" is already going.
      // That is a skip, not a fault: nothing is broken and the failure budget
      // must not be charged for it.
      const msg = errMsg(err);
      if (/already in progress/i.test(msg)) {
        return { outcome: 'skipped', summary: 'a run is already in progress' };
      }
      return { outcome: 'error', summary: msg.slice(0, 200) };
    }

    const shipped = data.actions.filter((a) => a.kind === 'tool_shipped').length;
    const repaired = data.actions.filter((a) => a.kind === 'tool_repaired').length;
    const queued = data.actions.filter((a) => a.kind === 'backlog_added').length;
    const prs = data.actions.filter((a) => a.kind === 'pr_opened').length;
    const policy = data.actions.filter(
      (a) => a.kind === 'policy_published' || a.kind === 'policy_kept' || a.kind === 'policy_reverted',
    ).length;

    const bits = [
      data.status,
      `${shipped} tool(s) shipped`,
      ...(repaired ? [`${repaired} repaired`] : []),
      `${queued} queued`,
      ...(prs ? [`${prs} draft PR(s)`] : []),
      ...(policy ? [`${policy} policy action(s)`] : []),
      `${data.llmCalls} LLM call(s)`,
    ];

    const failedPhases = Object.entries(data.phases)
      .filter(([, p]) => p.status === 'failed')
      .map(([name]) => name);
    if (failedPhases.length) bits.push(`failed: ${failedPhases.join(', ')}`);

    return {
      outcome: FAILED_STATUSES.has(data.status) ? 'error' : 'ok',
      summary: bits.join(' · ').slice(0, 200),
      costUsd: data.costUsd,
      details: {
        runId,
        status: data.status,
        phases: data.phases,
        llmCalls: data.llmCalls,
        tokensIn: data.tokensIn,
        tokensOut: data.tokensOut,
        costUsd: data.costUsd,
        shipped,
        repaired,
        queued,
        prs,
      },
    };
  },
};
