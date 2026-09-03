import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listJobs } from '$lib/workflows/chat/job-store';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { runPonder } from '$lib/daydream/ponder/run';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';
import { loadResolvedEffort } from '$lib/daydream/effort.server';

const NAME = 'daydream-ponder';

interface PonderConfig {
  /** Skip a run if the owner messaged inside this window — same spare-cycles
   *  contract the composer keeps. */
  idleWindowMinutes?: number;
}

const DEFAULTS: Required<PonderConfig> = { idleWindowMinutes: 20 };

/**
 * The thinking half of the second brain.
 *
 * Every two hours of quiet, the model gets the fact pack — family, diary,
 * money, health, email facts, its own discoveries — and proposes musings,
 * lines of enquiry and standing rules as structured data. Code audits every
 * citation before anything is stored; the thought ledger's threshold, mutes
 * and delivery caps stand between a musing and the owner's phone exactly as
 * they do for every rule-detected thought.
 *
 * Spends the same Codex caps as the composer — this is precisely what "spare
 * budget buys THINKING, never talking" was written for.
 */
export const daydreamPonder: ActivityHandler = {
  name: NAME,
  description:
    'The ponder engine: on spare cycles the model reads the fact pack (family, diary, money, health, email facts, past discoveries) and proposes cited musings, lines of enquiry, and standing action rules as data. Code audits every citation; delivery gates unchanged. Spends against the Codex caps.',
  defaultCadenceSeconds: 7200,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as PonderConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // Spare cycles means spare — same two gates as the composer.
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
    const effort = await loadResolvedEffort();
    if (budget.blocked) {
      return { outcome: 'skipped', summary: `budget: ${budget.blockedReason}`, details: { budget } };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    let result;
    try {
      result = await runPonder({
        now,
        verify: budget.plan.verify && effort.compose.verify,
        lookupBudget: effort.ponder.lookupBudget,
        caps: { maxMusings: effort.ponder.maxMusings, maxLeads: effort.ponder.maxLeads },
      });
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const m = result.musings;
    const bits = [
      `${result.cards} cards`,
      `${m.proposed} musings (${m.created} new, ${m.updated} refreshed, ${m.suppressed} held, ${m.muted} muted)`,
      `${result.leadsCreated} leads opened${result.leadsDuplicate ? ` (${result.leadsDuplicate} already open)` : ''}`,
      ...(result.rulesAdmitted || result.rulesRefused
        ? [`rules: ${result.rulesAdmitted} proposed, ${result.rulesRefused} refused`]
        : []),
      // The fabrication meter. Always reported — a quiet audit is a claim.
      `audit dropped ${result.rejected.length}`,
    ];
    // Only when the stage did something: a line reading "0 lookups" on every
    // pulse is noise, but a probe budget spent for no cards is worth seeing.
    // A near-miss the validator repaired. Visible, because an alias silently
    // accepted is how entity_id/entityId cost 44% of one toolset's calls while
    // reading as facts about the estate.
    if (result.coerced.length > 0) bits.push(`${result.coerced.length} metric name(s) coerced`);
    if (result.lookups.asked > 0) {
      bits.push(
        `looked up ${result.lookups.asked} → ${result.lookups.cards} card(s)` +
          (result.lookups.failed ? `, ${result.lookups.failed} failed` : ''),
      );
    }
    if (result.error) bits.push(`error: ${result.error}`);

    return {
      outcome: result.error && m.proposed === 0 && result.leadsCreated === 0 ? 'error' : 'ok',
      summary: bits.join(' · '),
      promptTokens: result.tokens.prompt,
      completionTokens: result.tokens.completion,
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
