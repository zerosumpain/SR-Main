import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listChatJobs } from '$lib/workflows/chat/activity';
import {
  attributeSpend,
  budgetStatus,
  hasThinkingHeadroom,
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
        // Spare budget buys THINKING, never talking — the standing rule for
        // this quota. So headroom does not raise the musing cap (which would
        // mostly buy more of the echoes the first pass already produces); it
        // buys a second, adversarial reading of the same cards.
        //
        // Gated on HEADROOM, not on pace. `plan.depth` answers "are we behind
        // where the day's burn should be?", and because pacing starts at 07:00
        // while the overnight jobs spend from 02:30, the day was always ahead
        // of pace by breakfast — so the second pass only ever ran in the
        // evening. `hasThinkingHeadroom` asks whether a real slice of both
        // caps is still unspent, which is the actual question.
        adversary: hasThinkingHeadroom(budget),
      });
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const m = result.musings;
    const bits = [
      // The lens leads the summary: reading a week of pulses should show the
      // rotation turning, which is the only cheap way to catch it stuck.
      `${result.lens} lens`,
      `${result.cards} cards`,
      // `merged` was missing here, and its absence is why the repetition went
      // unseen for a month: a cycle reading "2 musings (0 new, 0 refreshed, 0
      // held, 0 muted)" looks like a quiet night, and what actually happened is
      // that both were absorbed into claims already live.
      `${m.proposed} musings (${m.created} new, ${m.merged} merged, ${m.updated} refreshed, ${m.suppressed} held, ${m.muted} muted)`,
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
    if (result.adversary.ran) {
      bits.push(
        `second pass: ${result.adversary.dropped.length} dropped, ${result.adversary.sharpened} sharpened`,
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
