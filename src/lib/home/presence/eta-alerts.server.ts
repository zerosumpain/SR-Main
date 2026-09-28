import { fetchHousehold } from './companion';
import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { pilotRecipients, postToPilot, localClock, type PilotEvent } from './alerts';
import { insightMembers, loadPresenceInsights } from './insights.server';
import { type ArrivalInsight } from './insights';
import { listMembers, type HouseholdMember } from './members';
import { isApnsConfigured } from '$lib/server/apns';
import { pushToEmails } from '$lib/server/push-devices';

export function arrivalEvent(a: ArrivalInsight, members: HouseholdMember[]): PilotEvent | null {
  const recipients = pilotRecipients(members, a.subject);
  if (!recipients.length) return null;
  const id = `eta-${createHash('sha256').update(a.id).digest('hex').slice(0, 36)}`;
  return { id, recipients, at: a.observedAt, title: `${a.person} · ${a.returningHome ? 'likely heading home' : `likely heading to ${a.to}`}`,
    body: `Estimated arrival ${localClock(new Date(a.earliest))}–${localClock(new Date(a.latest))}. Based on ${a.samples} similar trips; destination inferred, no live traffic.` };
}
/** Existing app followers receive one event per journey, by push or the app queue. */
export async function deliverArrivalEstimates(): Promise<{ sent: number }> {
  const canQueue = !!process.env.COMPANION_HOUSEHOLD_TOKEN?.trim();
  const canPush = isApnsConfigured();
  if (!canQueue && !canPush) return { sent: 0 };
  const snapshot = await fetchHousehold('').catch(() => null);
  if (!snapshot?.revision) return { sent: 0 };
  const members = await listMembers();
  const movers = await insightMembers({ kind: 'owner' }, members);
  const data = await loadPresenceInsights({ kind: 'owner' }, 28);
  let sent = 0;
  for (const a of data.arrivals) {
    // Sharing controls whose movement is announced, not whether a follower may hear it.
    if (!movers.some(m => m.subject === a.subject)) continue;
    const event = arrivalEvent(a, members);
    if (!event) continue;
    const ttl = Math.min(300, Math.floor((+new Date(a.latest) - Date.now()) / 1000));
    if (ttl <= 0) continue;
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${event.id}))`);
      const key = `home.presence.eta.${a.subject}`;
      const [stored] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
      const previous = stored?.value as { id?: string; deliveredTo?: string[]; complete?: boolean } | undefined;
      if (previous?.id === event.id && previous.complete) return;
      const delivered = new Set(previous?.id === event.id ? previous.deliveredTo ?? [] : []);
      const recipients = [...new Set(event.recipients.map(r => r.trim().toLowerCase()))];
      const pending = recipients.filter(r => !delivered.has(r));
      if (!pending.length) return;
      if (canPush) {
        const outcome = await pushToEmails(pending, { title: event.title, body: event.body,
          category: 'household', threadId: 'household', level: 'active', collapseId: event.id,
          userInfo: { id: event.id, category: 'household', url: '/home/people' }, ttlSeconds: ttl });
        for (const r of pending) if (outcome.reached.has(r)) delivered.add(r);
      }
      // A phone reached by APNs is excluded from the pull queue to avoid two banners.
      const remaining = pending.filter(r => !delivered.has(r));
      if (remaining.length && canQueue) {
        const result = await postToPilot([{ ...event, recipients: remaining }], fetch, snapshot.revision);
        if (result?.accepted.includes(event.id)) for (const r of remaining) delivered.add(r);
      }
      if (!pending.some(r => delivered.has(r))) return;
      const value = { id: event.id, at: a.observedAt, deliveredTo: [...delivered], complete: recipients.every(r => delivered.has(r)) };
      await tx.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
      sent++;
    });
  }
  return { sent };
}
