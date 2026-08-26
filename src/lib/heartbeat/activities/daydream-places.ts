import { getSetting } from '$lib/server/models/settings';
import { pruneTrail } from '$lib/daydream/observe';
import { refreshPlaces } from '$lib/daydream/places';
import { SETTINGS_ENABLED_KEY, TRAIL_RETENTION_DAYS } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-places';

interface PlacesConfig {
  /** How far back to recluster. Defaults to the retention horizon, so the
   *  place graph reflects everything the trail still holds. */
  windowDays?: number;
  /** Drop raw fixes past retention. Places are aggregates and survive. */
  prune?: boolean;
  retentionDays?: number;
}

const DEFAULTS: Required<PlacesConfig> = {
  windowDays: TRAIL_RETENTION_DAYS,
  prune: true,
  retentionDays: TRAIL_RETENTION_DAYS,
};

/**
 * Re-derive the place graph from the trail, hourly.
 *
 * Separate from `daydream-observe` because the two have nothing in common but
 * a table: observing is a two-minute job that must not be delayed, and
 * reclustering is a whole-window recompute that would be wasteful at that
 * cadence and pointless more often than the trail materially changes.
 *
 * Runs long before it produces anything. A place needs three visits of a
 * quarter hour each before it exists at all, so the first fortnight of this
 * action's life is honest, cheap, and completely silent.
 */
export const daydreamPlacesRefresh: ActivityHandler = {
  name: NAME,
  description:
    'Reclusters the daydream trail into places hourly, refreshes their visit counts and rhythms, and prunes raw fixes past retention. A place needs 3 visits of 15+ minutes to exist, so this is silent for the first fortnight. No LLM.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as PlacesConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const refresh = await refreshPlaces({ windowDays: cfg.windowDays });
    const pruned = cfg.prune ? await pruneTrail(cfg.retentionDays) : 0;

    if (refresh.fixes === 0) {
      return { outcome: 'ok', summary: 'no fixes in the window yet' };
    }

    return {
      outcome: 'ok',
      summary:
        `${refresh.fixes} fixes → ${refresh.clusters} clusters; ` +
        `+${refresh.created} places, ${refresh.updated} updated, ${refresh.rejected} below the bar`,
      details: { ...refresh, pruned },
    };
  },
};
