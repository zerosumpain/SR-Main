// src/lib/home/presence/battery-alerts.server.ts
//
// Sends ./battery-alerts' "phone is on 14%" to each person's followers on the
// app. Runs on every household-live tick (30 s), after the pull, so the
// reading is the one the phone just sent. Push only: a low battery told an
// hour later is not worth a queued banner. State per person in app_settings
// `home.presence.battery.<subject>`.
//
// Never announced: anyone not sharing (or whose sharing is unknown — the
// pilot's users list unreadable fails closed), anyone on 'none', and the
// owner while a location hold is on.

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { isApnsConfigured } from '$lib/server/apns';
import { pushToEmails, type PushOutcome } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { displayNameOf, pilotRecipients, silencedMovers } from './alerts';
import { fetchHouseholdUsers } from './companion';
import { getHold, ownerSubjects } from './location-hold.server';
import type { HouseholdMember } from './members';
import { batteryStep, recordBatterySent, type BatteryReading, type BatteryState } from './battery-alerts';
import { errMsg } from './types';

export const BATTERY_KEY_PREFIX = 'home.presence.battery.';

async function newestReading(subject: string): Promise<BatteryReading | null> {
  const [row] = await db
    .select({ pct: daydreamTrail.batteryPct, ts: daydreamTrail.ts })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.batteryPct)))
    .orderBy(desc(daydreamTrail.ts))
    .limit(1);
  return row?.pct != null ? { pct: row.pct, at: row.ts } : null;
}

export async function deliverBatteryAlerts(
  members: readonly HouseholdMember[],
  deps: { now?: Date; push?: (emails: readonly string[], message: PushMessage) => Promise<PushOutcome> } = {},
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] };
  if (!isApnsConfigured()) return result;
  const now = deps.now ?? new Date();
  const push = deps.push ?? ((emails: readonly string[], message: PushMessage) => pushToEmails(emails, message));
  const users = (await fetchHouseholdUsers().catch(() => null))?.users ?? null;
  // Unknown sharing: nobody on the app is announced this run.
  if (!Array.isArray(users)) return result;
  const silenced = silencedMovers(members.map((m) => ({ subject: m.subject })), members, users);
  if (await getHold(now)) for (const s of ownerSubjects(members)) silenced.add(s);

  for (const m of members) {
    if (silenced.has(m.subject)) continue;
    const recipients = pilotRecipients(members, m.subject).map((r) => r.trim().toLowerCase());
    if (!recipients.length) continue;
    try {
      const key = `${BATTERY_KEY_PREFIX}${m.subject}`;
      const stored = await getSetting<BatteryState>(key);
      const step = batteryStep({
        subject: m.subject,
        name: displayNameOf(members, m.subject),
        reading: await newestReading(m.subject),
        state: stored,
        recipients,
        now,
      });
      let state = step.state;
      if (step.notice) {
        const outcome = await push(step.notice.recipients, step.notice.push);
        const reached = step.notice.recipients.filter((r) => outcome.reached.has(r));
        if (reached.length) result.sent++;
        state = recordBatterySent(state, reached);
      }
      if (JSON.stringify(state) !== JSON.stringify(stored)) await setSetting(key, state);
    } catch (err) {
      result.errors.push(`${m.subject}: ${errMsg(err).slice(0, 120)}`);
    }
  }
  return result;
}
