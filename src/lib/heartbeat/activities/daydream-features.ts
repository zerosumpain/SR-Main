import { getSetting } from '$lib/server/models/settings';
import { buildDayFeatures, DEFAULT_WINDOW_DAYS } from '$lib/daydream/features/build';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-features';

interface FeaturesConfig {
  /** How far back to recompute. The whole window every time, because the
   *  source tables are backfilled and corrected retrospectively. */
  windowDays?: number;
}

const DEFAULTS: Required<FeaturesConfig> = { windowDays: DEFAULT_WINDOW_DAYS };

/**
 * Rebuild the daily feature table — the row-per-day view that makes a
 * cross-domain question answerable at all.
 *
 * Recomputes the whole window rather than appending yesterday, because the
 * sources are not append-only: Whoop revises a night's figures hours later,
 * Apple backfills when a watch syncs, and activities arrive days after the
 * event. An incremental build would freeze whatever happened to be present at
 * midnight and quietly diverge from the source for ever.
 *
 * Cheap and completely silent: a few tens of thousands of rows read, one
 * upsert per day, no model, no notifications. It produces nothing anyone sees;
 * it is what the statistics and the hypothesis engine stand on.
 */
export const daydreamFeatures: ActivityHandler = {
  name: NAME,
  description:
    'Rebuilds the daily feature table for daydreaming — one row per local day joining trail, Apple health, Whoop and activities on a common key, with per-domain coverage so an absent reading never reads as a zero. No LLM.',
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as FeaturesConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const res = await buildDayFeatures({ windowDays: cfg.windowDays });

    // A source that produced nothing on every single day is a broken feed, not
    // a quiet life, and it must not read as a green tick. The correlation layer
    // would otherwise silently drop that whole dimension and report on what was
    // left as though it were the whole picture.
    const dead = Object.entries(res.absent)
      .filter(([, n]) => n === res.days && res.days > 0)
      .map(([domain]) => domain);

    if (res.errors.length && res.written === 0) {
      return {
        outcome: 'error',
        summary: `no days written — ${res.errors[0]}`,
        details: { ...res },
      };
    }

    // There is no 'partial' outcome, and a single dead feed must not be reported
    // as an error every six hours — that trains the owner to ignore the row,
    // which is how a real fault gets missed. It goes in the summary instead,
    // where the ledger renders it. Only a total blackout is a fault.
    const allDead = dead.length > 0 && dead.length === Object.keys(res.absent).length;

    return {
      outcome: allDead ? 'error' : 'ok',
      summary:
        `${res.written}/${res.days} days rebuilt` +
        (dead.length ? `; no data at all from ${dead.join(', ')}` : '') +
        (res.errors.length ? `; ${res.errors.length} errors` : ''),
      details: { ...res, dead },
    };
  },
};
