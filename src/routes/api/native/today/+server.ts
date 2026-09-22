import type { RequestHandler } from './$types';
import { desc } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { withDevice } from '$lib/server/native-handler';
import { getNativeHealthSummary } from '$lib/server/native-health';
import { pendingForDevice, recentEvents } from '$lib/server/notify';
import { loadNewsDesk } from '$lib/news/desk';

/**
 * GET /api/native/today — the first screen, in one request.
 *
 * Four separate calls would be the tidy decomposition and the wrong one. This
 * is the screen the app opens on, over whatever the phone is connected to, and
 * four round trips on a train is four chances to show a spinner. They are
 * settled in parallel and each failure degrades its own card rather than the
 * screen: Health being down leaves three cards and a note, not an error page.
 *
 * Everything here is a SUMMARY. The figure, the count, the headline. Tapping
 * any of it goes to the tab that owns it, which fetches properly. A first
 * screen that tried to be every screen would be slower than all of them.
 */
export const GET: RequestHandler = withDevice(async ({ url }, identity) => {
  const fresh = url.searchParams.get('fresh') === '1';

  const [healthResult, alertsResult, newsResult, threadResult] = await Promise.allSettled([
    getNativeHealthSummary({ fresh }),
    Promise.all([pendingForDevice(5), recentEvents(8)]),
    // `force: false` — the Today card takes whatever the desk last fetched.
    // Pulling four wires to draw three headlines on a screen somebody is about
    // to scroll past is the opposite of what this endpoint is for.
    loadNewsDesk({ view: 'top', sort: 'heat', limit: 3, force: false, ownerKey: identity.ownerEmail }),
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(1),
  ]);

  const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : null;
  const news = newsResult.status === 'fulfilled' ? newsResult.value : null;
  const thread = threadResult.status === 'fulfilled' ? threadResult.value[0] : undefined;

  if (healthResult.status === 'rejected') {
    console.error('[native] today: health unavailable', healthResult.reason);
  }

  return {
    generatedAt: new Date().toISOString(),
    health: health
      ? {
          isMock: health.isMock,
          strap: health.strap,
          readiness: health.readiness,
          // Four figures without their thirty-day series — the Today card draws
          // tiles, and a sparkline per tile on a card this small is decoration
          // carrying 120 numbers.
          figures: health.figures.map(({ series, ...rest }) => rest),
          generatedAt: health.generatedAt,
        }
      : null,
    alerts: alerts
      ? {
          pending: alerts[0].length,
          unread: alerts[1].filter((row) => !row.readAt).length,
          latest: alerts[1].slice(0, 3).map((row) => ({
            id: row.id,
            category: row.category,
            title: row.title,
            severity: row.severity,
            createdAt: row.createdAt.toISOString(),
          })),
        }
      : null,
    news: news
      ? {
          updatedAt: news.feed.updatedAt,
          unseen: news.feed.newSinceLast,
          stories: news.feed.stories.slice(0, 3).map((story) => ({
            key: story.key,
            title: story.title,
            sourceLabel: story.sourceLabel,
            url: story.url,
            heat: story.heat,
          })),
        }
      : null,
    lastThread: thread
      ? { id: thread.id, title: thread.title, updatedAt: thread.updatedAt.toISOString() }
      : null,
  };
});
