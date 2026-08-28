import { getSetting } from '$lib/server/models/settings';
import { buildDigest } from '$lib/daydream/digest/build';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-digest';

/**
 * Write yesterday's card.
 *
 * Notifies nobody. It writes a row the owner reads when he chooses to, which is
 * the entire point: it is the place quiet output lands, so thinking volume can
 * rise without interruption volume rising with it.
 *
 * Runs every six hours rather than once at dawn, because the day it summarises
 * is still settling when it is first written — a nightly sweep finishes after
 * midnight, Whoop revises a night hours later — and the digest recomputes
 * itself rather than freezing a half-formed account. No LLM: the summary is
 * assembled from counts.
 */
export const daydreamDigest: ActivityHandler = {
  name: NAME,
  description:
    "Writes one card a day summarising everything daydreaming did — questions asked and answered, what held and what came back empty, what it noticed and whether it said anything. Reports quiet days as clearly as busy ones. Notifies nobody. No LLM.",
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: {},

  async run() {
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const res = await buildDigest();
    if (!res.written) {
      return { outcome: 'error', summary: res.error ?? 'digest failed', details: { day: res.day } };
    }

    return {
      outcome: 'ok',
      summary: `${res.day}: ${res.summary}`,
      details: { day: res.day, ...res.stats },
    };
  },
};
