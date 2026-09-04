import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { runDoctorNow } from '$lib/workflowdoctor/run';
import type { PhaseName, PhaseRecord } from '$lib/workflowdoctor/types';
import { IDLE_WINDOW_MS, SETTINGS_ENABLED_KEY, errMsg } from '$lib/workflowdoctor/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-doctor';

interface DoctorConfig {
  /** Run on `homeserv` too. Off by default — the dev database's canvases are
   *  not production's, and a breaker flip there fixes nothing. The env
   *  override `WORKFLOW_DOCTOR_ALLOW_DEV=1` still works and is checked too. */
  allowDevHost?: boolean;
}

const DEFAULTS: Required<DoctorConfig> = { allowDevHost: false };

/**
 * The workflow doctor, on the heartbeat instead of its own croner.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * The site was still running two idle-cycle schedulers. Self-improvement gave
 * its croner up on 2026-08-30 for the heartbeat's per-activity cadence,
 * windows that reschedule rather than lock out, quota attribution, outcome
 * dots and a failure budget; the doctor kept a private `croner` at 05:00 with
 * its own host gate, its own kill switch and its own idle gate that nothing
 * else could see. The second scheduler had no advantage left.
 *
 * Only the SCHEDULING moved. `runDoctorNow` is untouched, still writes one
 * `doctor_runs` record a night, still holds the `jkai:workflow-doctor`
 * advisory lock, and both switches (`workflowdoctor.breaker`,
 * `workflowdoctor.autoapply`) mean exactly what they did.
 *
 * ── Where the fold actually is ──────────────────────────────────────────────
 *
 * Not here. A shared scheduler is tidiness; the fold is that the propose phase
 * now escalates a finding a human has to write code for into
 * `daydream_faults`, which self-improvement reads first. One ledger of what is
 * broken, one queue of what to do about it.
 */
export const daydreamDoctor: ActivityHandler = {
  name: NAME,
  description:
    'The workflow doctor: triages failed canvas runs over a 7-day window, lints the persisted graph, explains each failure in plain English, flips the circuit breaker on a runaway schedule, repairs node config inside a narrow whitelist when auto-apply is on, and escalates anything needing repo code into the daydream fault ledger — where self-improvement picks it up. One doctor_runs record per night. Skips when the owner has been active in the last hour.',
  // Daily; the window is what decides when it lands.
  defaultCadenceSeconds: 86_400,
  defaultEnabled: true,
  // 05:00–05:55 Europe/London — the slot the croner used, and still the free
  // one: 02:30 improve, 04:00 model-routing, 04:15 intel, 06:30 briefing,
  // 06:45 connector alert. The run is capped at its own `maxWallMs`, so a late
  // start inside this window still lands well before the briefing engine.
  defaultActiveHours: { start: '05:00', end: '05:55', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as DoctorConfig) };

    if (
      os.hostname() === 'homeserv' &&
      !cfg.allowDevHost &&
      process.env.WORKFLOW_DOCTOR_ALLOW_DEV !== '1'
    ) {
      return { outcome: 'skipped', summary: 'host is homeserv — the doctor runs on prod only' };
    }

    // House semantics: unset/null is ENABLED, only an explicit false disables.
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'kill switch is off' };

    if (await isUserActive(IDLE_WINDOW_MS)) {
      return { outcome: 'skipped', summary: 'owner active in the last hour' };
    }

    let runId: string;
    let data;
    try {
      ({ runId, data } = await runDoctorNow({ trigger: 'cron' }));
    } catch (err) {
      // The overlap guard and the advisory lock both throw when another
      // instance is already in the lane. That is a skip, not a fault.
      const msg = errMsg(err);
      if (/already in progress|lock/i.test(msg)) {
        return { outcome: 'skipped', summary: 'a doctor run is already in progress' };
      }
      return { outcome: 'error', summary: msg.slice(0, 200) };
    }

    const count = (kind: string) => data.actions.filter((a: { kind: string }) => a.kind === kind).length;
    const escalated = count('escalated');

    const bits = [
      data.status,
      `${count('diagnosed')} diagnosed`,
      ...(count('fix_applied') ? [`${count('fix_applied')} fixed`] : []),
      ...(count('schedule_quarantined') ? [`${count('schedule_quarantined')} schedule(s) stopped`] : []),
      ...(escalated ? [`${escalated} escalated to the fault ledger`] : []),
      ...(data.findingsResolved ? [`${data.findingsResolved} resolved`] : []),
      `${data.llmCalls} LLM call(s)`,
    ];

    const failedPhases = (Object.entries(data.phases) as Array<[PhaseName, PhaseRecord]>)
      .filter(([, p]) => p.status === 'failed')
      .map(([name]) => name);
    if (failedPhases.length) bits.push(`failed: ${failedPhases.join(', ')}`);

    return {
      outcome: data.status === 'failed' ? 'error' : 'ok',
      summary: bits.join(' · ').slice(0, 200),
      costUsd: data.costUsd,
      details: {
        runId,
        status: data.status,
        phases: data.phases,
        llmCalls: data.llmCalls,
        costUsd: data.costUsd,
        findingsResolved: data.findingsResolved,
        escalated,
      },
    };
  },
};
