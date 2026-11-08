// src/lib/today/today.server.ts
//
// One Today, three readers: the phone's first screen (`/api/native/today`),
// the jkai desk (Core, through `/api/platform/jkai/today`) and the chat tool
// `today_overview`. They used to be three answers to one question; now each
// asks this loader for the sections it draws.
//
// Every section is settled in parallel and fails on its own to null. A Health
// outage costs the health card, never the page — the property the phone's
// route was written around, kept for every reader.
//
// Owner only. The callers gate (a paired owner phone, the service credential
// Core uses on the owner's behalf, an owner chat turn); nothing in here knows
// who is asking, so nothing in here may be reached without that gate.

import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import { getNativeHealthSummary } from '$lib/server/native-health';
import { pendingForDevice, recentEvents } from '$lib/server/notify';
import { loadNewsDesk } from '$lib/news/desk';
import { connectorAttention } from '$lib/connectors/watch-store';
import { loadTodayNotes } from '$lib/daydream/think/notes.server';
import { loadDaydreamSummary, type DaydreamSummary } from '$lib/daydream/summary.server';
import { loadHubCounts } from '$lib/daydream/hub-counts.server';
import { listBriefingDays, loadBriefingDay } from '$lib/briefing/dashboard.server';
import { toNativeBriefing } from '$lib/briefing/native';
import { toWaitingDelivery, type TodaySection, type WaitingDelivery } from './today';

export interface TodayNeedsYou {
  /** Commissions needing his OK, reports back, drafted follow-ups — never plain unrated notes. */
  daydream: Pick<DaydreamSummary, 'counts' | 'waiting'>;
  deliveries: WaitingDelivery[];
  /** Fact checks running on their own, and the last think cycle — context, not asks. */
  checksRunning: number;
  lastCycleAt: string | null;
}

export interface TodayBriefing {
  day: string;
  title: string;
  headline: string;
  dateLabel: string;
  generatedAt: string;
  verified: boolean;
  href: string;
}

/** How many waiting notes and deliveries a reader is sent. */
const NEEDS_YOU_LIMIT = 6;

async function loadNeedsYou(): Promise<TodayNeedsYou> {
  const [summary, deliveryRows, counts] = await Promise.all([
    loadDaydreamSummary({ limit: NEEDS_YOU_LIMIT }),
    db
      .select({ buildId: jkaiBuildDeliveries.buildId, state: jkaiBuildDeliveries.state, title: jkaiBuilds.title, prompt: jkaiBuilds.prompt })
      .from(jkaiBuildDeliveries)
      .innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
      .orderBy(desc(jkaiBuildDeliveries.updatedAt))
      .limit(200),
    loadHubCounts(),
  ]);
  const deliveries = deliveryRows.map(toWaitingDelivery).filter((d): d is WaitingDelivery => !!d).slice(0, NEEDS_YOU_LIMIT);
  return {
    daydream: { counts: summary.counts, waiting: summary.waiting },
    deliveries,
    checksRunning: counts.checks.running,
    lastCycleAt: counts.think.lastCycleAt ? counts.think.lastCycleAt.toISOString() : null,
  };
}

async function loadLatestBriefing(): Promise<TodayBriefing | null> {
  const days = [...new Set((await listBriefingDays(1)).map((d) => d.id))];
  const day = days[0];
  const record = day ? await loadBriefingDay(day) : null;
  if (!day || !record) return null;
  const b = toNativeBriefing(day, record, days);
  return {
    day: b.day,
    title: b.title,
    headline: b.headline,
    dateLabel: b.dateLabel,
    generatedAt: b.generatedAt,
    verified: b.verified,
    href: `/jkai/daydreams/briefing/${encodeURIComponent(b.day)}`,
  };
}

/** The loaders, by section. Each returns a promise; a section not asked for is never started. */
function start(section: TodaySection, opts: { ownerKey: string; fresh: boolean }): Promise<unknown> {
  switch (section) {
    case 'health':
      return getNativeHealthSummary({ fresh: opts.fresh });
    case 'alerts':
      return Promise.all([pendingForDevice(5), recentEvents(8)]);
    case 'news':
      // `force: false` — the Today card takes whatever the desk last fetched.
      // Pulling four wires to draw three headlines on a screen somebody is about
      // to scroll past is the opposite of what this endpoint is for.
      return loadNewsDesk({ view: 'top', sort: 'heat', limit: 3, force: false, ownerKey: opts.ownerKey });
    case 'connections':
      // The watcher's stored answer — the same set /api/native/connections lists.
      return connectorAttention();
    case 'daydream':
      // The Noticed card: the daydream loop's two newest notes from the last
      // 48 hours that he has not turned down (`think/notes.ts`).
      return loadTodayNotes();
    case 'lastThread':
      return db
        .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
        .from(conversations)
        // The owner's latest thread — never a member's.
        .where(eq(conversations.principalId, 'owner'))
        .orderBy(desc(conversations.updatedAt))
        .limit(1);
    case 'needsYou':
      return loadNeedsYou();
    case 'briefing':
      return loadLatestBriefing();
  }
}

type Settled = Partial<Record<TodaySection, PromiseSettledResult<unknown>>>;

function value<T>(settled: Settled, section: TodaySection): T | null {
  const r = settled[section];
  return r && r.status === 'fulfilled' ? (r.value as T) : null;
}

/**
 * Today, for the sections asked for, in a fixed key order (the phone's
 * contract test pins it). Everything is a SUMMARY: the figure, the count, the
 * headline. Tapping any of it goes to the page that owns it.
 */
export async function loadToday(opts: { ownerKey: string; fresh?: boolean; sections: readonly TodaySection[] }) {
  const sections = [...new Set(opts.sections)];
  const results = await Promise.allSettled(sections.map((s) => start(s, { ownerKey: opts.ownerKey, fresh: opts.fresh === true })));
  const settled: Settled = {};
  sections.forEach((s, i) => (settled[s] = results[i]));

  for (const s of sections) {
    const r = settled[s];
    if (r?.status !== 'rejected') continue;
    // The phone's two messages are kept word for word; logs are searched by them.
    if (s === 'health') console.error('[native] today: health unavailable', r.reason);
    else if (s === 'daydream') console.error('[native] today: daydream notes unavailable', r.reason);
    else if (s === 'needsYou' || s === 'briefing') console.error(`[today] ${s} unavailable`, r.reason);
  }

  const want = (s: TodaySection) => sections.includes(s);
  const out: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  if (want('health')) {
    const health = value<Awaited<ReturnType<typeof getNativeHealthSummary>>>(settled, 'health');
    out.health = health
      ? {
          isMock: health.isMock,
          strap: health.strap,
          readiness: health.readiness,
          // Four figures without their thirty-day series — the Today card draws
          // tiles, and a sparkline per tile on a card this small is decoration
          // carrying 120 numbers.
          figures: health.figures.map(({ series: _series, ...rest }) => rest),
          generatedAt: health.generatedAt,
        }
      : null;
  }
  if (want('alerts')) {
    const alerts = value<[unknown[], Array<{ id: string; category: string; title: string; severity: string; createdAt: Date; readAt: Date | null }>]>(settled, 'alerts');
    out.alerts = alerts
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
      : null;
  }
  if (want('news')) {
    const news = value<Awaited<ReturnType<typeof loadNewsDesk>>>(settled, 'news');
    out.news = news
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
      : null;
  }
  if (want('connections')) {
    const connections = value<Awaited<ReturnType<typeof connectorAttention>>>(settled, 'connections');
    out.connections = connections ? { needsAttention: connections.items.length, items: connections.items.slice(0, 3) } : null;
  }
  if (want('daydream')) {
    const notes = value<Awaited<ReturnType<typeof loadTodayNotes>>>(settled, 'daydream');
    out.daydream = notes ? { notes } : null;
  }
  if (want('lastThread')) {
    const thread = value<Array<{ id: string; title: string | null; updatedAt: Date }>>(settled, 'lastThread')?.[0];
    out.lastThread = thread ? { id: thread.id, title: thread.title, updatedAt: thread.updatedAt.toISOString() } : null;
  }
  if (want('needsYou')) out.needsYou = value<TodayNeedsYou>(settled, 'needsYou');
  if (want('briefing')) out.briefing = value<TodayBriefing>(settled, 'briefing');
  return out;
}
