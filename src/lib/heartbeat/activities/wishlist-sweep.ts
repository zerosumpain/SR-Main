import os from 'node:os';
import { sweepWishlist } from '$lib/wishlist/sweep.server';
import type { ActivityHandler } from '../types';

const NAME = 'wishlist-sweep';

/**
 * Check the wish list: hunts for new listings that meet their criteria,
 * tracked products for price changes.
 *
 * Ticks every fifteen minutes but does little on most ticks — each item has
 * its own cadence (`$lib/wishlist/due`: hunts six-hourly, tracked prices
 * two-hourly, hourly through Black Friday week), and a tick checks only what is
 * due. No LLM: the model reads an item once, when it is added; every listing
 * after that is judged by code. Web search (Tavily) runs at most daily per hunt.
 *
 * A quiet tick is `ok`. A source that failed is reported on the item and in
 * the summary, never as an `error` outcome on its own — one retailer's bot
 * wall is the normal weather, not the sweep being broken.
 */
export const wishlistSweep: ActivityHandler = {
  name: NAME,
  description:
    'Checks the wish list: hunts hotukdeals and PriceRunner for listings that meet each item\'s criteria, and re-reads tracked products for price drops, targets and stock. One message per item when something moved. No LLM per listing.',
  defaultCadenceSeconds: 15 * 60,
  defaultEnabled: true,
  defaultConfig: {},

  async run(ctx) {
    // Prod only, as voice-drift: homeserv's dev service shares the WhatsApp
    // route, and a test item there must not message the owner's phone.
    if (os.hostname() === 'homeserv' && process.env.WISHLIST_ALLOW_DEV !== '1') {
      return { outcome: 'skipped', summary: 'host is homeserv — the sweep runs on prod only' };
    }
    const result = await sweepWishlist(new Date(ctx.now));
    if (result.checked.length === 0) {
      return { outcome: 'ok', summary: result.due ? `${result.due} due, none checked` : 'nothing due' };
    }
    const events = result.checked.reduce((n, c) => n + c.events, 0);
    const failed = result.checked.filter((c) => c.errors.length).length;
    return {
      outcome: 'ok',
      summary: `checked ${result.checked.length} of ${result.due} due · ${events} alert-worthy · ${failed} with source errors`,
      details: { checked: result.checked },
    };
  },
};
