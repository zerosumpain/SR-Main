import { getSetting } from '$lib/server/models/settings';
import { buildDayFeatures, DEFAULT_WINDOW_DAYS } from '$lib/daydream/features/build';
import { DEFAULT_SUBJECT, SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-features';

interface FeaturesConfig {
  /** How far back to recompute. The whole window every time, because the
   *  source tables are backfilled and corrected retrospectively. */
  windowDays?: number;
}

const DEFAULTS: Required<FeaturesConfig> = { windowDays: DEFAULT_WINDOW_DAYS };

/**
 * Rebuild the daily feature table — the row-per-day view that `correlate`
 * (the think loop's statistics tool) reads its series from.
 *
 * Recomputes the whole window rather than appending yesterday, because the
 * sources are not append-only: Whoop revises a night's figures hours later,
 * Apple backfills when a watch syncs, and activities arrive days after the
 * event. An incremental build would freeze whatever happened to be present at
 * midnight and quietly diverge from the source for ever.
 *
 * Cheap and completely silent: a few tens of thousands of rows read, one
 * upsert per day, no model, no notifications.
 *
 * OWNER ONLY since P4a (2026-09-25). The per-person rows were built from the
 * household GPS trail, which was retired with the rest of location (spec D1
 * revised); health, diary and spend were only ever the owner's.
 */
export const daydreamFeatures: ActivityHandler = {
  name: NAME,
  description:
    'Rebuilds the owner\'s daily feature table for daydreaming — one row per local day joining Apple health, Whoop, activities, verified spend and the diary on a common key, with per-domain coverage so an absent reading never reads as a zero. The series `correlate` reads. No LLM.',
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

    // A source that produced nothing on every single day is a broken feed,
    // not a quiet life, and it must not read as a green tick. The correlation
    // layer would otherwise silently drop that whole dimension and report on
    // what was left as though it were the whole picture.
    const dead = Object.entries(res.absent)
      .filter(([, n]) => n === res.days && res.days > 0)
      .map(([domain]) => domain);
    const allDead = dead.length > 0 && dead.length === Object.keys(res.absent).length;

    if (res.errors.length && res.written === 0) {
      return { outcome: 'error', summary: `no days written for ${DEFAULT_SUBJECT} — ${res.errors[0]}`, details: { ...res, dead } };
    }
    return {
      outcome: allDead ? 'error' : 'ok',
      summary:
        `${res.written}/${res.days} day-rows` +
        (dead.length ? ` (no ${dead.join('/')})` : '') +
        (res.errors.length ? ` · ${res.errors.length} err` : ''),
      details: { ...res, dead },
    };
  },
};
