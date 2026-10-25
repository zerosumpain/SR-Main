import { errMsg } from '$lib/home/presence/types';
import type { ActivityHandler } from '../types';

/**
 * The family forecast's nightly round: the scorecard (the last four weeks of
 * real trips replayed through the forecast and scored against what then
 * happened) and the digest (what changed in everyone's movements, and each
 * person's week of health from the app), both kept for /home and
 * /home/people. Every 15 minutes inside a half-hour window after 2am; a
 * second run the same night replaces the first. Each half reports on its own,
 * so one failing does not lose the other. No LLM.
 */
export const forecastNightly: ActivityHandler = {
  name: 'forecast-nightly',
  description:
    'Scores the family forecast against the last 28 days of real trips, and builds the weekly digest (what changed in movements, each person\'s week of app health) for /home and /home/people. Nightly, London. No LLM.',
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '02:00', end: '02:30', tz: 'Europe/London' },
  defaultConfig: {},

  async run(ctx) {
    const now = new Date(ctx.now);
    const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
    const parts: string[] = [];
    let failed = 0;
    const details: Record<string, unknown> = {};
    try {
      const { runScorecard } = await import('$lib/home/presence/forecast-eval.server');
      const card = await runScorecard(now);
      if (card) {
        parts.push(`next ${pct(card.next.precision)} right, ${pct(card.next.recall)} foreseen; band ${pct(card.duration.band)}; ETA ${pct(card.eta.window)}`);
        details.scorecard = { next: card.next, duration: card.duration, eta: card.eta, odds: card.odds, overdue: card.overdue };
      } else parts.push('scorecard: nobody sharing');
    } catch (err) {
      failed++;
      parts.push(`scorecard failed: ${errMsg(err).slice(0, 80)}`);
    }
    try {
      const { runDigest } = await import('$lib/home/presence/forecast-digest.server');
      const d = await runDigest(now);
      parts.push(`${d.changes.length} changes, health for ${Object.keys(d.health).length}`);
    } catch (err) {
      failed++;
      parts.push(`digest failed: ${errMsg(err).slice(0, 80)}`);
    }
    return { outcome: failed === 2 ? 'error' : 'ok', summary: parts.join(' · ').slice(0, 200), details };
  },
};
