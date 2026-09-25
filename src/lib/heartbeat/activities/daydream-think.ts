import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listChatJobs } from '$lib/workflows/chat/activity';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
  type Depth,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/model';
import { runThink, MAX_ROUNDS } from '$lib/daydream/think/run';
import { wakeSnoozed } from '$lib/daydream/thought-store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-think';

interface ThinkConfig {
  /** Skip a run if the owner messaged inside this window — the same
   *  spare-cycles contract ponder and the composer keep. */
  idleWindowMinutes?: number;
}

const DEFAULTS: Required<ThinkConfig> = { idleWindowMinutes: 20 };

/** Tool rounds by budget depth. A round is a model call, so a thin budget buys
 *  a shorter investigation rather than no investigation. */
const ROUNDS_BY_DEPTH: Record<Depth, number> = { minimal: 3, standard: 5, deep: MAX_ROUNDS };

/**
 * The think loop — one question, investigated with tools, 0–2 cited notes.
 *
 * Every 45 minutes of quiet in waking hours, the clock picks a channel × outcome
 * pair (`think/questions.ts`), the model investigates it with ONE of two
 * read-only tool sets (`think/tools.ts`), and whatever survives the citation
 * audit goes to the owner through `notifyOwner`. Runs beside ponder until P2
 * retires it (spec 2026-09-25).
 *
 * Spends the same Codex caps as ponder and the composer — which is why it is in
 * `SPENDING_ACTIONS` and why `details.quota` below is load-bearing.
 */
export const daydreamThink: ActivityHandler = {
  name: NAME,
  description:
    'The think loop: on spare cycles, one question (channel × outcome, rotated evenly by the clock) is investigated with a read-only tool set — private data or the web, never both — and at most two cited notes are written. Code audits every citation; new notes reach the owner through the daydream notification category. Spends against the Codex caps.',
  defaultCadenceSeconds: 45 * 60,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ThinkConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // A snooze has to end somewhere. The detect pass that used to wake them was
    // retired (P4a), and the context panel still offers "snooze a week" — so
    // this cheap update runs every tick, spare or not.
    await wakeSnoozed(now).catch((err) => console.warn(`[daydream] wake snoozed failed: ${errMsg(err)}`));

    // Spare cycles means spare — ponder's two gates, unchanged.
    const running = (await listChatJobs()).filter((j) => j.status === 'running');
    if (running.length > 0) {
      return { outcome: 'skipped', summary: `${running.length} job(s) in flight — not spare` };
    }
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner active in the last few minutes' };
    }

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });
    if (budget.blocked) {
      return { outcome: 'skipped', summary: `budget: ${budget.blockedReason}`, details: { budget } };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    let result;
    try {
      result = await runThink({ now, maxRounds: ROUNDS_BY_DEPTH[budget.plan.depth] });
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const n = result.notes;
    const bits = [
      // The question leads, so a week of pulses shows the rotation turning.
      `${result.channel} × ${result.outcome}`,
      `${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}${result.toolFailures ? ` (${result.toolFailures} failed)` : ''}`,
      // `merged` always shown: its absence is how ponder's repetition went
      // unseen for a month.
      `${n.proposed} note${n.proposed === 1 ? '' : 's'} (${n.created} new${n.merged ? `, ${n.merged} merged` : ''}${n.updated ? `, ${n.updated} refreshed` : ''}${n.suppressed ? `, ${n.suppressed} held` : ''}${n.muted ? `, ${n.muted} muted` : ''})`,
      ...(result.notified ? [`${result.notified} sent`] : []),
      ...(result.backlog.length ? [`${result.backlog.length} to the backlog`] : []),
      // The fabrication meter. Always reported — a quiet audit is a claim.
      `audit dropped ${result.rejected.length}`,
    ];
    if (result.error) bits.push(`error: ${result.error}`);

    return {
      outcome: result.error && n.proposed === 0 ? 'error' : 'ok',
      summary: bits.join(' · '),
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        depth: budget.plan.depth,
        model: model.modelId,
        ...result,
      },
    };
  },
};
