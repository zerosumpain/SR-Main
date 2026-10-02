// The family alarm — storage and pushes. The rules are in ./alarm (PURE); this
// file reads and writes `family_alarm` and rings everybody else's phone.

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyAlarm } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import { familyId, familyPersonFor, familyRoster } from './roster.server';
import {
  ACTIVE_MS,
  alarmPush,
  alarmRecipients,
  cancelPush,
  decideRaise,
  samePerson,
  type AlarmInput,
  type AlarmRecord,
} from './alarm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Critical alerts need Apple's entitlement first, so they are opt-in by env. */
export function criticalAlertsEnabled(): boolean {
  return process.env.APNS_CRITICAL_ALERTS?.trim() === '1';
}

/** The id the phone knows a person by — the steps board's and the task list's. */
export function alarmFromId(email: string): string {
  return familyId(email.trim().toLowerCase());
}

export type RaiseResult =
  | { kind: 'new' | 'existing'; alarm: AlarmRecord; pushed: number; recipients: number }
  | { kind: 'limited'; retryAfterSeconds: number };

/**
 * Raise an alarm for `email`, or answer with the one already sounding.
 *
 * The decision and the insert run under a per-sender advisory lock, so two
 * presses arriving together make ONE alarm, not two that each ring everyone.
 * The push happens after the commit: the row is the floor the pull reads, and
 * it must exist even when Apple is unreachable.
 */
export async function raiseAlarm(
  email: string,
  parent: boolean,
  input: AlarmInput,
  now = new Date(),
  push = pushToEmails,
): Promise<RaiseResult> {
  const sender = email.trim().toLowerCase();
  const lockKey = `family-alarm:${isOwnerEmail(sender) ? 'owner' : sender}`;
  const person = await familyPersonFor(sender, parent);
  const roster = await familyRoster(now.getTime());
  const { emails, people } = alarmRecipients(sender, roster.map((p) => p.email), getOwnerEmails(), isOwnerEmail);
  const senderEmails = isOwnerEmail(sender) ? getOwnerEmails() : [sender];

  const decided = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const [latest] = await tx
      .select()
      .from(familyAlarm)
      .where(inArray(familyAlarm.fromEmail, senderEmails))
      .orderBy(desc(familyAlarm.createdAt))
      .limit(1);
    const decision = decideRaise(latest ?? null, now);
    if (decision.kind !== 'new') return decision;
    const [row] = await tx
      .insert(familyAlarm)
      .values({
        fromEmail: sender,
        fromName: person.name,
        kind: input.kind,
        message: input.message,
        lat: input.position?.lat ?? null,
        lon: input.position?.lon ?? null,
        accuracy: input.position?.accuracy ?? null,
        recipientCount: people,
        createdAt: now,
      })
      .returning();
    return { kind: 'new' as const, alarm: row };
  });

  if (decided.kind === 'limited') return decided;
  if (decided.kind === 'existing') {
    const a = decided.alarm;
    return { kind: 'existing', alarm: a, pushed: a.pushedCount, recipients: a.recipientCount };
  }

  const alarm = decided.alarm;
  let pushed = 0;
  try {
    const outcome = await push(emails, alarmPush(alarm, alarmFromId(sender), criticalAlertsEnabled()));
    pushed = outcome.sent;
    await db.update(familyAlarm).set({ pushedCount: pushed }).where(eq(familyAlarm.id, alarm.id));
  } catch (error) {
    console.error(`[family] alarm ${alarm.id}: push failed`, (error as Error).message);
  }
  console.warn(`[family] alarm ${alarm.id} raised (${alarm.kind}): ${people} people, ${pushed} phones`);
  return { kind: 'new', alarm: { ...alarm, pushedCount: pushed }, pushed, recipients: people };
}

export async function getAlarm(id: string): Promise<AlarmRecord | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(familyAlarm).where(eq(familyAlarm.id, id)).limit(1);
  return row ?? null;
}

/**
 * Stand an alarm down and tell the same people, quietly. Idempotent: a second
 * cancel changes nothing and pushes nothing. Authorisation is the caller's
 * (`mayCancel`) — this only records it.
 */
export async function cancelAlarm(
  alarm: AlarmRecord,
  byEmail: string,
  byParent: boolean,
  now = new Date(),
  push = pushToEmails,
): Promise<{ alarm: AlarmRecord; pushed: number }> {
  const by = byEmail.trim().toLowerCase();
  const [row] = await db
    .update(familyAlarm)
    .set({ cancelledAt: now, cancelledByEmail: by })
    .where(and(eq(familyAlarm.id, alarm.id), isNull(familyAlarm.cancelledAt)))
    .returning();
  if (!row) return { alarm: (await getAlarm(alarm.id)) ?? alarm, pushed: 0 };

  let pushed = 0;
  try {
    const roster = await familyRoster(now.getTime());
    const { emails } = alarmRecipients(row.fromEmail, roster.map((p) => p.email), getOwnerEmails(), isOwnerEmail);
    const byName = samePerson(by, row.fromEmail, isOwnerEmail) ? null : (await familyPersonFor(by, byParent)).name;
    pushed = (await push(emails, cancelPush(row, alarmFromId(row.fromEmail), byName))).sent;
  } catch (error) {
    console.error(`[family] alarm ${row.id}: cancel push failed`, (error as Error).message);
  }
  return { alarm: row, pushed };
}

/** Alarms raised in the last 30 minutes and not stood down, newest first. */
export async function activeAlarms(now = new Date()): Promise<AlarmRecord[]> {
  return db
    .select()
    .from(familyAlarm)
    .where(and(gte(familyAlarm.createdAt, new Date(now.getTime() - ACTIVE_MS)), isNull(familyAlarm.cancelledAt)))
    .orderBy(desc(familyAlarm.createdAt));
}
