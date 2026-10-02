// The family alarm — the pure half: reading what the phone sent, the
// rate-limit decision, who is told, and the exact push each phone receives.
// No database, no clock of its own. Storage and sending are ./alarm.server.
//
// A family member in danger presses "raise the alarm" on the iPhone app's
// Family tab, and every OTHER family member's phone rings: the owner's when a
// member raises it, every member's when the owner does.

import type { PushMessage } from '$lib/server/apns';

export const ALARM_KINDS = ['siren', 'morse'] as const;
export type AlarmKind = (typeof ALARM_KINDS)[number];

export const ALARM_CATEGORY = 'family-alarm';
export const ALARM_CANCEL_CATEGORY = 'family-alarm-cancel';
export const MESSAGE_MAX = 140;
/** An alarm is active for this long after it is raised, unless stood down. */
export const ACTIVE_MS = 30 * 60_000;
/** At most one NEW alarm per sender in this window. */
export const RAISE_GAP_MS = 30_000;

/** The sound file bundled in the app for each kind. */
export const SOUND_FILE: Record<AlarmKind, string> = { siren: 'sr-siren.caf', morse: 'sr-morse.caf' };

export interface AlarmPosition {
  lat: number;
  lon: number;
  accuracy: number | null;
}

export interface AlarmInput {
  kind: AlarmKind;
  message: string | null;
  position: AlarmPosition | null;
}

/** An alarm as stored (the columns of `family_alarm`, camel-cased). */
export interface AlarmRecord {
  id: string;
  fromEmail: string;
  fromName: string;
  kind: string;
  message: string | null;
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  recipientCount: number;
  pushedCount: number;
  createdAt: Date;
  cancelledAt: Date | null;
  cancelledByEmail: string | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * What the phone sent, or an error sentence.
 *
 * Strict only where the app is in control of the value (`kind`). The rest is
 * forgiving on purpose — this is pressed in an emergency, and refusing it for
 * a long message or a bad GPS fix would be the worst possible answer: a long
 * message is cut to 140 characters, and a position that is not a real place
 * (iOS's invalid coordinate is -180,-180) is dropped and the alarm still goes.
 */
export function parseAlarmInput(body: unknown): AlarmInput | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind ?? 'siren';
  if (typeof kind !== 'string' || !(ALARM_KINDS as readonly string[]).includes(kind)) {
    return { error: 'kind must be "siren" or "morse".' };
  }
  const text = typeof b.message === 'string' ? b.message.trim().slice(0, MESSAGE_MAX).trim() : '';
  let position: AlarmPosition | null = null;
  const p = b.position as Record<string, unknown> | null | undefined;
  if (p && typeof p === 'object' && finite(p.lat) && finite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
    position = { lat: p.lat, lon: p.lon, accuracy: finite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null };
  }
  return { kind: kind as AlarmKind, message: text || null, position };
}

/** Owner emails are one person: the owner pressing on any of them is "the owner". */
export function samePerson(a: string, b: string, isOwner: (email: string) => boolean): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || (isOwner(x) && isOwner(y));
}

export function isActive(alarm: Pick<AlarmRecord, 'createdAt' | 'cancelledAt'>, now: Date): boolean {
  return !alarm.cancelledAt && now.getTime() - alarm.createdAt.getTime() < ACTIVE_MS;
}

export type RaiseDecision =
  | { kind: 'new' }
  /** Pressed again while their alarm is still sounding: answer with that one. */
  | { kind: 'existing'; alarm: AlarmRecord }
  /** A new alarm inside the gap after the last (stood-down) one. */
  | { kind: 'limited'; retryAfterSeconds: number };

/** Given the sender's most recent alarm (or none), what a press does now. */
export function decideRaise(latest: AlarmRecord | null, now: Date): RaiseDecision {
  if (!latest) return { kind: 'new' };
  if (isActive(latest, now)) return { kind: 'existing', alarm: latest };
  const since = now.getTime() - latest.createdAt.getTime();
  if (since < RAISE_GAP_MS) return { kind: 'limited', retryAfterSeconds: Math.ceil((RAISE_GAP_MS - since) / 1000) };
  return { kind: 'new' };
}

/**
 * Who is told, by email, and how many PEOPLE that is: everybody in the family
 * but the sender. The owner's allow-listed emails are all pushed (each may hold
 * a phone) but count as one person; when the owner raises it none of them is.
 */
export function alarmRecipients(
  senderEmail: string,
  familyEmails: readonly string[],
  ownerEmails: readonly string[],
  isOwner: (email: string) => boolean,
): { emails: string[]; people: number } {
  const sender = senderEmail.trim().toLowerCase();
  const all = new Set([...familyEmails, ...ownerEmails].map((e) => e.trim().toLowerCase()).filter(Boolean));
  const emails = [...all].filter((e) => !samePerson(e, sender, isOwner));
  const owners = emails.filter(isOwner).length;
  return { emails, people: emails.length - owners + (owners > 0 ? 1 : 0) };
}

/** The alarm push. Critical only when `critical` (APNS_CRITICAL_ALERTS=1). */
export function alarmPush(alarm: AlarmRecord, fromId: string, critical: boolean): PushMessage {
  const kind: AlarmKind = alarm.kind === 'morse' ? 'morse' : 'siren';
  const file = SOUND_FILE[kind];
  return {
    title: `${alarm.fromName} raised the alarm`,
    body: alarm.message || 'They pressed the alarm on the SR app. Open to see where they are.',
    category: ALARM_CATEGORY,
    threadId: ALARM_CATEGORY,
    level: critical ? 'critical' : 'time-sensitive',
    sound: critical ? { critical: 1, name: file, volume: 1.0 } : file,
    relevance: 1,
    collapseId: `alarm-${alarm.id}`,
    // Apple keeps trying a phone that is off for as long as the alarm is live.
    ttlSeconds: ACTIVE_MS / 1000,
    userInfo: {
      category: ALARM_CATEGORY,
      alarmId: alarm.id,
      from: fromId,
      name: alarm.fromName,
      kind,
      lat: alarm.lat,
      lon: alarm.lon,
      at: alarm.createdAt.toISOString(),
    },
  };
}

/** The quiet follow-up. Same collapse id, so it REPLACES the alarm on the phone. */
export function cancelPush(alarm: AlarmRecord, fromId: string, byName: string | null): PushMessage {
  return {
    title: `${alarm.fromName} is OK — alarm stood down`,
    body: byName ? `Stood down by ${byName}.` : 'They stood the alarm down.',
    category: ALARM_CANCEL_CATEGORY,
    threadId: ALARM_CATEGORY,
    level: 'active',
    sound: 'default',
    collapseId: `alarm-${alarm.id}`,
    ttlSeconds: ACTIVE_MS / 1000,
    userInfo: {
      category: ALARM_CANCEL_CATEGORY,
      alarmId: alarm.id,
      from: fromId,
      name: alarm.fromName,
      kind: alarm.kind,
      at: alarm.createdAt.toISOString(),
    },
  };
}

/** Only the sender, or the owner, may stand an alarm down. */
export function mayCancel(alarm: Pick<AlarmRecord, 'fromEmail'>, callerEmail: string, callerIsOwner: boolean, isOwner: (email: string) => boolean): boolean {
  return callerIsOwner || samePerson(alarm.fromEmail, callerEmail, isOwner);
}

/** One alarm as the phone receives it. */
export function alarmView(alarm: AlarmRecord, fromId: string) {
  return {
    alarmId: alarm.id,
    from: fromId,
    name: alarm.fromName,
    kind: alarm.kind,
    message: alarm.message,
    lat: alarm.lat,
    lon: alarm.lon,
    accuracy: alarm.accuracy,
    at: alarm.createdAt.toISOString(),
    cancelledAt: alarm.cancelledAt?.toISOString() ?? null,
  };
}
