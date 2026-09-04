import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listJobs } from '$lib/workflows/chat/job-store';
import { attributeSpend, budgetStatus, readQuotaMark, ZERO_SPEND } from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { runAppetite } from '$lib/daydream/appetite/run';
import { scannedToday } from '$lib/daydream/appetite/store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { loadResolvedEffort } from '$lib/daydream/effort.server';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-appetite';

interface AppetiteConfig {
  /** Skip a run if the owner messaged inside this window — the same
   *  spare-cycles contract the composer and ponder keep. */
  idleWindowMinutes?: number;
  /** Proposals one scan may admit. Overrides the effort dial when set
   *  explicitly on the row (`applyEffort`'s rule: a hand-tuned row wins). */
  maxLeads?: number;
}

const DEFAULTS: Required<AppetiteConfig> = { idleWindowMinutes: 20, maxLeads: 0 };

/**
 * What the site should be able to do and cannot.
 *
 * Every other stage of this engine looks at the owner's life. This one looks
 * at the site: the types of question being asked, the sources and tools it can
 * already reach, and the places daydreaming came up short — and asks what
 * capability is missing. Survivors land on the appetite ledger, where
 * self-improvement picks them up under its own switches.
 *
 * Hourly inside the window with a once-a-day guard rather than a daily cadence:
 * a daily row that lands while the owner is at his desk skips and does not
 * come back until tomorrow, and the scan is exactly the sort of thing that
 * would then never run. The guard is what keeps that from turning one model
 * call a day into four.
 */
export const daydreamAppetite: ActivityHandler = {
  name: NAME,
  description:
    'The appetite scan: reads the types of question being asked, an inventory of every source, API, toolset, watch, feed and schedule the site can already reach, and the faults where daydreaming came up short — then proposes capabilities the site does not have. Every proposal must cite the pack or it is dropped. Survivors go to the appetite ledger and the strongest become ordinary thoughts, routed to the briefing. It cannot build anything; self-improvement drains the ledger.',
  // Hourly attempt; the window and the once-a-day guard decide when it lands.
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  // Evening, after the day's questions exist and before the 02:30 improvement
  // run that reads the ledger.
  defaultActiveHours: { start: '20:00', end: '23:30', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as AppetiteConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'daydreaming disabled' };

    if (await scannedToday(NAME, now)) {
      return { outcome: 'skipped', summary: 'already scanned today' };
    }

    const running = listJobs().filter((j) => j.status === 'running');
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

    const effort = await loadResolvedEffort();
    const maxLeads = cfg.maxLeads > 0 ? cfg.maxLeads : effort.appetite.maxLeads;

    const before = isCodexModel ? await readQuotaMark() : null;
    let result;
    try {
      result = await runAppetite({ maxLeads });
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const bits = [
      `${result.packFacts} facts`,
      `${result.proposed} proposed → ${result.admitted} admitted`,
      `${result.created} new, ${result.refreshed} refreshed`,
      // Always reported. A quiet audit is a claim.
      `audit dropped ${result.dropped.length}`,
    ];
    if (result.bridged.offered) {
      bits.push(
        `${result.bridged.offered} bridged (${result.bridged.created} new, ${result.bridged.suppressed} held)`,
      );
    }
    if (result.error) bits.push(`error: ${result.error}`);

    return {
      // A cycle that proposed nothing is a legitimate answer — the pack may
      // genuinely hold no gap. Only a thrown call or a bridge failure is an
      // error, and neither loses the ledger.
      outcome: result.error && result.admitted === 0 ? 'error' : 'ok',
      summary: bits.join(' · ').slice(0, 200),
      promptTokens: result.tokens.prompt,
      completionTokens: result.tokens.completion,
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        model: model.modelId,
        maxLeads,
        ...result,
      },
    };
  },
};
