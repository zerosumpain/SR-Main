// The briefing and Today, for chat — READS only (overhaul plan 2026-10-28,
// P2-6, slice 4). Both wrap the loaders the phone already uses: the Morning
// report (`toNativeBriefing`) and the shared Today (`$lib/today`).
//
// Owner-only: not member-safe, not on the WhatsApp list, not offered to the
// heartbeat, and refused in the handler for any other principal.

import { register } from '../registry-internal';
import { listBriefingDays, loadBriefingDay } from '$lib/briefing/dashboard.server';
import { isBriefingDay, NATIVE_DAYS_MAX, toNativeBriefing } from '$lib/briefing/native';
import { getOwnerEmails } from '$lib/server/access';
import { loadToday } from '$lib/today/today.server';
import { refuseUnlessOwner } from './owner-only';

const MARKDOWN_CAP = 6000;

register({
  name: 'briefing_get',
  description:
    "John's morning briefing for one day (default the newest): the headline, the factor cards with their one-line readings, the connections between them, the gaps it could not fill, and the full text. Use for \"what did my briefing say\" or a question about a past morning. Returns the page link. Read-only.",
  parameters: {
    type: 'object',
    properties: { day: { type: 'string', description: 'The day as YYYY-MM-DD. Omit for the newest briefing.' } },
    required: [],
  },
  category: 'Briefing',
  toolset: 'briefing',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('briefing_get', ctx);
    if (refused) return refused;
    const asked = typeof args.day === 'string' && args.day.trim() ? args.day.trim() : null;
    if (asked !== null && !isBriefingDay(asked)) return { success: false, error: 'day must be YYYY-MM-DD' };
    const days = [...new Set((await listBriefingDays(NATIVE_DAYS_MAX)).map((d) => d.id))];
    const day = asked ?? days[0];
    const record = day ? await loadBriefingDay(day) : null;
    if (!day || !record) return { success: false, error: asked ? `No briefing for ${asked}` : 'No briefing has been written yet' };
    const b = toNativeBriefing(day, record, days);
    return {
      success: true,
      data: {
        day: b.day,
        title: b.title,
        dateLabel: b.dateLabel,
        headline: b.headline,
        verified: b.verified,
        mode: b.mode,
        url: `/jkai/daydreams/briefing/${encodeURIComponent(b.day)}`,
        factors: b.factors.map((f) => ({ label: f.label, group: f.group, status: f.status, headline: f.headline, salience: f.salience })),
        connections: b.connections,
        gaps: b.gaps,
        markdown: b.markdown.length > MARKDOWN_CAP ? `${b.markdown.slice(0, MARKDOWN_CAP)}…` : b.markdown,
        otherDays: b.days.filter((d) => d !== b.day),
      },
    };
  },
});

register({
  name: 'today_overview',
  description:
    "John's day at a glance, from the same loader as the /jkai desk and the phone's first screen: what needs him (double-checks waiting for his OK, daydream reports back, development features blocked on a question or a merge), the latest briefing's headline, health readiness, alert counts, connections needing attention and his last thread. Use for \"what needs me\", \"what's waiting on me\" or \"how's today looking\". Each section is null when it could not be read. Read-only.",
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Briefing',
  toolset: 'briefing',
  surfaces: ['chat', 'app'],
  handler: async (_args, ctx) => {
    const refused = refuseUnlessOwner('today_overview', ctx);
    if (refused) return refused;
    // No news: reading it stamps the owner's "new since you looked" visit.
    const today = await loadToday({
      ownerKey: getOwnerEmails()[0] ?? 'owner',
      sections: ['needsYou', 'briefing', 'health', 'alerts', 'connections', 'lastThread'],
    });
    return { success: true, data: { ...today, links: { daydreams: '/jkai/daydreams', develop: '/jkai/develop', health: '/health' } } };
  },
});
