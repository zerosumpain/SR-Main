import { getSetting } from '$lib/server/models/settings';
import { pruneTrail } from '$lib/daydream/observe';
import { reconcileNamedPlaceThoughts, refreshPlaces } from '$lib/daydream/places';
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
 * Runs long before it produces anything. A place needs a real stay before it
 * exists at all, so the first stretch of this action's life is honest, cheap,
 * and completely silent.
 */
export const daydreamPlacesRefresh: ActivityHandler = {
  name: NAME,
  description:
    'Reclusters the daydream trail into places hourly, refreshes their visit counts and rhythms, and prunes raw fixes past retention. A place needs one stay of 10+ still minutes to exist; a cluster the trail only passes through is retired as transit. No LLM.',
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

    // Close any question left standing about a place that has since been named.
    // Runs on every refresh rather than only when a name is typed, because the
    // trigger in `confirmPlace` only covers the one path that calls it.
    const reconciled = await reconcileNamedPlaceThoughts();

    if (refresh.fixes === 0) {
      return {
        outcome: 'ok',
        summary: reconciled
          ? `no fixes in the window yet; closed ${reconciled} stale question${reconciled === 1 ? '' : 's'}`
          : 'no fixes in the window yet',
        details: { reconciled },
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
        (refresh.retired ? `, ${refresh.retired} retired as transit` : '') +
        (reconciled ? `; closed ${reconciled} stale question${reconciled === 1 ? '' : 's'}` : ''),
      details: { ...refresh, pruned, reconciled },
    };
  },
};
