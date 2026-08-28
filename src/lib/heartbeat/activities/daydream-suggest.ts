import { getSetting } from '$lib/server/models/settings';
import { backfillSuggestions, DEFAULT_BATCH } from '$lib/daydream/suggest';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-suggest';

interface SuggestConfig {
  /** Places looked up per run. Bounded by Nominatim's one-per-second policy. */
  limit?: number;
}

const DEFAULTS: Required<SuggestConfig> = { limit: DEFAULT_BATCH };

/**
 * Ask the geocoder what the unnamed places are called, so the naming form opens
 * already filled in.
 *
 * Separate from `daydream-places` for the same reason that one is separate from
 * `daydream-observe`: reclustering is CPU over our own rows and can run whenever
 * it likes, while this makes outbound requests to a third party under a
 * published rate limit. Folding it into the hourly refresh would put a
 * 40-second sleep-and-fetch loop inside a job whose whole point is being cheap.
 *
 * Self-limiting by design. Once every active place has been asked about, the
 * queue is empty and this returns immediately for the next three months —
 * `suggestedAt` is stamped even on a blank answer precisely so the places that
 * can never resolve stop being retried. No LLM.
 */
export const daydreamSuggest: ActivityHandler = {
  name: NAME,
  description:
    'Reverse-geocodes unnamed daydream places so the naming form opens pre-filled with a name and street address. Rate-limited to one lookup per second per Nominatim policy, 30 per run, and goes quiet once the queue drains. No LLM.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as SuggestConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const res = await backfillSuggestions({ limit: cfg.limit });

    if (res.considered === 0) {
      return { outcome: 'ok', summary: 'every unnamed place already has a suggestion' };
    }

    // A run where every lookup failed is reported as a fault rather than as a
    // quiet success. The queue would otherwise drain to nothing over a Nominatim
    // outage with the ledger showing a green tick each hour.
    if (res.failed === res.considered) {
      return {
        outcome: 'error',
        summary: `all ${res.failed} lookups failed — geocoder unreachable?`,
        details: { ...res },
      };
    }

    return {
      outcome: 'ok',
      summary: `${res.considered} looked up — ${res.named} named, ${res.blank} with nothing to offer, ${res.failed} failed`,
      details: { ...res },
    };
  },
};
