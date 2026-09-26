import { pruneTrail } from '$lib/home/presence/observe';
import { refreshPlaces } from '$lib/home/presence/places';
import { TRAIL_RETENTION_DAYS } from '$lib/home/presence/types';
import type { ActivityHandler } from '../types';

// The name is the heartbeat_actions row's identity: it stays 'daydream-places'
// although the file moved, because renaming it would orphan the row.
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
 * Runs long before it produces anything. A place needs a real stay before it
 * exists at all, so the first stretch of this action's life is honest, cheap,
 * and completely silent.
 */
export const homePlaces: ActivityHandler = {
  name: NAME,
  description:
    'Reclusters the daydream trail into places hourly, refreshes their visit counts and rhythms, and prunes raw fixes past retention. A place needs one stay of 10+ still minutes to exist; a cluster the trail only passes through is retired as transit. No LLM.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as PlacesConfig) };

    const refresh = await refreshPlaces({ windowDays: cfg.windowDays });
    const pruned = cfg.prune ? await pruneTrail(cfg.retentionDays) : 0;

    if (refresh.fixes === 0) {
      return {
        outcome: 'ok',
        summary: 'no fixes in the window yet',
      };
    }

    return {
      outcome: 'ok',
      summary:
        `${refresh.fixes} fixes → ${refresh.clusters} clusters; ` +
        `+${refresh.created} places, ${refresh.updated} updated, ${refresh.rejected} below the bar` +
        // Retirements are named rather than folded into "below the bar": this
        // is the engine reclassifying somewhere it had previously called a
        // place, and a count that quietly shrinks is the thing to avoid.
        (refresh.retired ? `, ${refresh.retired} retired as transit` : ''),
      details: { ...refresh, pruned },
    };
  },
};
