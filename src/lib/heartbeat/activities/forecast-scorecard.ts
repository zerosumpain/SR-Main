import { errMsg } from '$lib/home/presence/types';
import type { ActivityHandler } from '../types';

/**
 * The family forecast's nightly scorecard: the last four weeks of real trips
 * replayed through the forecast, scored against what then happened, and kept
 * for /home/people's "How good is the forecast" band. Every 15 minutes inside
 * a half-hour window after midnight; a second run the same night replaces the
 * first. No LLM.
 */
export const forecastScorecard: ActivityHandler = {
  name: 'forecast-scorecard',
  description:
    'Replays the last 28 days of family trips through the forecast and scores it (next moves, journey times, live ETAs, overdue alerts) for /home/people. Nightly, London. No LLM.',
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '02:00', end: '02:30', tz: 'Europe/London' },
  defaultConfig: {},

  async run(ctx) {
    try {
      const { runScorecard } = await import('$lib/home/presence/forecast-eval.server');
      const card = await runScorecard(new Date(ctx.now));
      if (!card) return { outcome: 'skipped', summary: 'nobody is sharing' };
      const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
      return {
        outcome: 'ok',
        summary: `${card.from}–${card.to}: next ${pct(card.next.precision)} right, ${pct(card.next.recall)} foreseen; band ${pct(card.duration.band)}; ETA ${pct(card.eta.window)}`,
        details: { next: card.next, duration: card.duration, eta: card.eta, overdue: card.overdue },
      };
    } catch (err) {
      return { outcome: 'error', summary: `failed: ${errMsg(err).slice(0, 160)}` };
    }
  },
};
