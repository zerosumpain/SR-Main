import { getSetting } from '$lib/server/models/settings';
import { buildDayFeatures, DEFAULT_WINDOW_DAYS } from '$lib/daydream/features/build';
import { DEFAULT_SUBJECT, FAMILY_SUBJECTS, SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
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
 *
 * ── Every person, not just John (2026-08-28) ──────────────────────────────
 *
 * The table is keyed (subject, day) and had only ever held `john`, so making
 * hypotheses per-person would have proposed questions about four people that
 * nothing could answer. The trail has carried all five since the family
 * backfill.
 *
 * What each person's row contains differs, and honestly: the trail features
 * are theirs, while health, diary and spend are John's alone and stay ABSENT
 * for everybody else. Absent is not zero here — the whole feature store is
 * built on that distinction — so a correlation involving sleep simply has no
 * pairs for Katie rather than a column of false zeroes.
 */
export const daydreamFeatures: ActivityHandler = {
  name: NAME,
  description:
    'Rebuilds the daily feature table for daydreaming, for every person in the trail — one row per subject per local day joining trail, Apple health, Whoop and activities on a common key, with per-domain coverage so an absent reading never reads as a zero. Health, diary and spend are the owner\'s alone and stay absent for everyone else. No LLM.',
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as FeaturesConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const perSubject: Record<string, unknown> = {};
    const lines: string[] = [];
    let written = 0;
    let ownerAllDead = false;
    let ownerFailed: string | null = null;

    for (const { subject } of FAMILY_SUBJECTS) {
      const res = await buildDayFeatures({ windowDays: cfg.windowDays, subject });

      // A source that produced nothing on every single day is a broken feed,
      // not a quiet life, and it must not read as a green tick. The
      // correlation layer would otherwise silently drop that whole dimension
      // and report on what was left as though it were the whole picture.
      const dead = Object.entries(res.absent)
        .filter(([, n]) => n === res.days && res.days > 0)
        .map(([domain]) => domain);
      const allDead = dead.length > 0 && dead.length === Object.keys(res.absent).length;

      written += res.written;
      perSubject[subject] = { ...res, dead };
      lines.push(
        `${subject} ${res.written}/${res.days}` +
          (dead.length ? ` (no ${dead.join('/')})` : '') +
          (res.errors.length ? ` ${res.errors.length} err` : ''),
      );

      // Only the OWNER's build can raise a fault. The other four legitimately
      // have no health, diary or spend, so judging them by the same rule would
      // paint the row red every six hours for a state that is correct — and a
      // row that is always red is a row nobody reads.
      if (subject === DEFAULT_SUBJECT) {
        ownerAllDead = allDead;
        if (res.errors.length && res.written === 0) ownerFailed = res.errors[0];
      }
    }

    if (ownerFailed) {
      return {
        outcome: 'error',
        summary: `no days written for ${DEFAULT_SUBJECT} — ${ownerFailed}`,
        details: { perSubject },
      };
    }

    return {
      outcome: ownerAllDead ? 'error' : 'ok',
      summary: `${written} day-rows across ${FAMILY_SUBJECTS.length} people · ${lines.join(' · ')}`,
      details: { perSubject, written },
    };
  },
};
