// The family alarm — storage and pushes. The rules are in ./alarm (PURE); this
// file reads and writes `family_alarm` and rings everybody else's phone.

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyAlarm } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { pushToEmails } from '$lib/server/push-devices';
import { livePositions } from '$lib/home/presence/household';
import { familyId, familyPersonFor, familyRoster } from './roster.server';
import { recordMessage, senderSubjects } from './messages.server';
import {
  ACTIVE_MS,
  alarmPush,
  alarmRecipients,
  cancelPush,
  decideRaise,
  driveMinutesByEmail,
  quietMessageBody,
  quietPushes,
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

/** How long the Bat phone waits for positions before it goes without the drive. */
const POSITIONS_WAIT_MS = 3_000;

/**
 * Each recipient's drive to the alarm, from their last fix on the household
 * trail (`livePositions`: sharing people only). A failed or slow read is no
 * estimate — the push goes without that part rather than late, and the app
 * works the ETA out on open.
 */
async function driveMinutes(emails: readonly string[], alarm: AlarmRecord, now: Date): Promise<Map<string, number>> {
  if (alarm.lat === null || alarm.lon === null || !emails.length) return new Map();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = Promise.all([senderSubjects(), livePositions()]);
    const slow = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), POSITIONS_WAIT_MS);
      timer.unref?.();
    });
    const got = await Promise.race([read, slow]);
    if (!got) {
      console.warn(`[family] alarm ${alarm.id}: positions too slow, pushing without the drive`);
      read.catch(() => {});
      return new Map();
    }
    return driveMinutesByEmail(emails, alarm, got[0], got[1], now);
  } catch (error) {
    console.error(`[family] alarm ${alarm.id}: positions unreadable`, (error as Error).message);
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

/** The Bat phone's pushes: per recipient, each with the drive from THEM (`quietPushes`). */
async function pushQuiet(emails: readonly string[], alarm: AlarmRecord, fromId: string, now: Date, push: typeof pushToEmails): Promise<number> {
  const minutes = await driveMinutes(emails, alarm, now);
  let sent = 0;
  for (const p of quietPushes(emails, alarm, fromId, criticalAlertsEnabled(), minutes)) sent += (await push(p.emails, p.message)).sent;
  return sent;
}

/**
 * Raise an alarm for `email`, or answer with the one already sounding.
 *
 * The decision and the insert run under a per-sender advisory lock, so two
 * presses arriving together make ONE alarm, not two that each ring everyone.
 * The push happens after the commit: the row is the floor the pull reads, and
 * it must exist even when Apple is unreachable.
 *
 * A Bat phone (kind `quiet`) is pushed per recipient, and also written into
 * "msg family" — without a second push — so the family's history shows it.
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
    const decision = decideRaise(latest ?? null, now, input.kind);
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
        battery: input.battery,
        place: input.place,
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
    pushed =
      alarm.kind === 'quiet'
        ? await pushQuiet(emails, alarm, alarmFromId(sender), now, push)
        : (await push(emails, alarmPush(alarm, alarmFromId(sender), criticalAlertsEnabled()))).sent;
    await db.update(familyAlarm).set({ pushedCount: pushed }).where(eq(familyAlarm.id, alarm.id));
  } catch (error) {
    console.error(`[family] alarm ${alarm.id}: push failed`, (error as Error).message);
  }
  if (alarm.kind === 'quiet') {
    await recordMessage(sender, person.name, quietMessageBody(alarm), { recipients: people, pushed }, now).catch((error) =>
      console.error(`[family] alarm ${alarm.id}: msg family record failed`, (error as Error).message),
    );
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
