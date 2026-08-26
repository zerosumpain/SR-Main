import { getSetting } from '$lib/server/models/settings';
import {
  hasFreshFix,
  pollHomeAssistant,
  recordFix,
  recordGap,
} from '$lib/daydream/observe';
import { OBSERVE_CADENCE_SECONDS, SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-observe';

interface ObserveConfig {
  /** Stand down while the push stream is this fresh. */
  pushFreshMins?: number;
  /** The Home Assistant entity carrying the position. */
  personEntity?: string;
}

const DEFAULTS: Required<ObserveConfig> = {
  pushFreshMins: 10,
  personEntity: 'person.john',
};

/**
 * The poll floor under the daydream trail.
 *
 * Home Assistant pushes on GPS change, which is the high-fidelity path and the
 * one that carries the trail while you are moving. This exists for the two
 * cases that path cannot cover:
 *
 *  1. **Stillness.** The push only fires on movement, so a quiet afternoon
 *     produces no rows at all. Without a floor, "sat at home" and "phone off"
 *     look identical in the trail.
 *  2. **The link being down.** HA runs on homeserv; the site runs on the VPS.
 *     When homeserv is down the poll fails — and that failure is written as a
 *     `gap` row rather than skipped, because a detector must be able to tell
 *     "nothing happened" from "nobody was watching". Every "you have not left
 *     the house in three days" depends on that distinction being recorded.
 *
 * No LLM, so cost is zero and the cadence can be short.
 */
export const daydreamObserve: ActivityHandler = {
  name: NAME,
  description:
    'Poll floor for the daydream trail. Records where John is when the Home Assistant push stream has gone quiet, and records an explicit gap row when it looks and cannot see — so coverage is computable rather than assumed. No LLM.',
  // Same constant coverage divides by. Written once so they cannot drift.
  defaultCadenceSeconds: OBSERVE_CADENCE_SECONDS,
  defaultEnabled: true,
  // Deliberately 24/7: a trail with a nightly hole cannot answer "did he sleep
  // at home", and the gap rows would make that hole indistinguishable from an
  // outage.
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ObserveConfig) };

    // Unset/null means enabled, matching the self-improvement engine.
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    if (await hasFreshFix(cfg.pushFreshMins * 60_000)) {
      return {
        outcome: 'ok',
        summary: `push stream fresh (<${cfg.pushFreshMins}m) — no poll needed`,
      };
    }

    const polled = await pollHomeAssistant(cfg.personEntity);

    if ('error' in polled) {
      // Not an error outcome: HA being unreachable from the VPS is an ordinary
      // recurring state, and marking it `error` would burn the action's
      // failure budget and eventually pause the one thing recording that we
      // cannot see. The gap row IS the result.
      await recordGap(polled.error);
      return {
        outcome: 'ok',
        summary: `gap recorded: ${polled.error.slice(0, 120)}`,
        details: { gap: true, reason: polled.error },
      };
    }

    try {
      const fix = await recordFix(polled.fix, 'poll');
      return {
        outcome: 'ok',
        summary: `fix @ ${fix.mode}${fix.isHome ? ' (home)' : ''}${
          fix.placeId ? ' at a known place' : ''
        }`,
        details: {
          trailId: fix.id,
          mode: fix.mode,
          speedKmh: fix.speedKmh,
          placeId: fix.placeId,
          isHome: fix.isHome,
          distanceHomeKm: fix.distanceHomeKm,
        },
      };
    } catch (err) {
      const reason = errMsg(err);
      await recordGap(`fix rejected: ${reason}`);
      return { outcome: 'error', summary: reason.slice(0, 200) };
    }
  },
};
