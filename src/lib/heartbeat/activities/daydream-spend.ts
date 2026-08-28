import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamSpend } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { EMPTY_EXTRACT, extractSpend } from '$lib/daydream/spend/read';
import { spendDensity } from '$lib/daydream/spend/extract';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-spend';

interface SpendConfig {
  limit?: number;
  sinceDays?: number;
}

const DEFAULTS: Required<SpendConfig> = { limit: 15, sinceDays: 30 };

/**
 * Read what was actually paid out of what was actually a receipt.
 *
 * Reports its own density every run, and says plainly that it is not yet dense
 * enough to correlate. That is the honest state: at build time the mailbox
 * yielded about four receipts a week, which is nulls on most days, and letting
 * that into the correlation sweep would produce underpowered verdicts at best
 * and spurious ones at worst. It accumulates first and earns its way in later.
 *
 * The subject-line shortlist runs before any model call, so a run over a
 * quiet week costs nothing at all.
 */
export const daydreamSpendExtract: ActivityHandler = {
  name: NAME,
  description:
    'Extracts merchant and amount from genuinely receipt-shaped email. A free subject-line filter picks the shortlist; only the shortlist reaches a model, and an amount that does not appear verbatim in the source is refused. Reports how far the data is from being dense enough to correlate. Always understates: no cash, no card-present spend without a receipt.',
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as SpendConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // Extraction calls a model, so it spends against the same Codex caps as the
    // composer — daydream-spend is in SPENDING_ACTIONS and writes its quota
    // delta to details.quota below. Blocked budget → skip extraction entirely
    // (receipts keep for six hours); tight budget → the scan yields to the
    // composer and takes the smaller share, same as the offer scan.
    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now: new Date(ctx.now), isCodexModel });

    let quota = { ...ZERO_SPEND };
    let res: Awaited<ReturnType<typeof extractSpend>>;
    if (budget.blocked) {
      res = { ...EMPTY_EXTRACT, errors: [] };
    } else {
      const cap = budget.plan.depth === 'deep' ? cfg.limit : Math.min(5, cfg.limit);
      const before = isCodexModel ? await readQuotaMark() : null;
      res = await extractSpend({ limit: cap, sinceDays: cfg.sinceDays });
      const after = isCodexModel ? await readQuotaMark() : null;
      quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };
    }

    const [totals] = await db
      .select({
        n: sql<number>`count(*)::int`,
        days: sql<number>`greatest(1, (max(${daydreamSpend.day}) - min(${daydreamSpend.day})))::int`,
      })
      .from(daydreamSpend);
    const density = spendDensity(totals?.n ?? 0, totals?.days ?? 0);

    const bits = budget.blocked
      ? [`extraction skipped — ${budget.blockedReason}`]
      : [
          `${res.shortlisted} of ${res.considered} looked like receipts`,
          `${res.written} recorded`,
        ];
    // A model that has started inventing totals shows up here rather than in
    // the data, because the verification refuses the row silently otherwise.
    if (res.unverified) bits.push(`${res.unverified} refused — amount not in the source`);
    bits.push(
      density.readyForSweep
        ? `${density.perWeek}/week — dense enough to correlate`
        : `${density.perWeek}/week, needs ${density.needed} to be worth correlating`,
    );

    // Every extraction failing while some were shortlisted is a fault; finding
    // no receipts at all in a quiet week is not.
    if (res.shortlisted > 0 && res.written === 0 && res.errors.length) {
      return { outcome: 'error', summary: bits.join('; '), details: { quota, ...res, density } };
    }

    // The quota key is load-bearing: budget.ts reads it back to enforce the caps.
    return { outcome: 'ok', summary: bits.join('; '), details: { quota, ...res, density } };
  },
};
