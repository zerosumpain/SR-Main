// The family alarm — the pure half: reading what the phone sent, the
// rate-limit decision, who is told, and the exact push each phone receives.
// No database, no clock of its own. Storage and sending are ./alarm.server.
//
// A family member in danger presses "raise the alarm" on the iPhone app's
// Family tab, and every OTHER family member's phone rings: the owner's when a
// member raises it, every member's when the owner does.
//
// The "Bat phone" is the same alarm, kind `quiet`: a discreet urgent alert
// with the ordinary notification sound, whose text tells each recipient where
// the sender is, their battery and roughly how far a drive it is from THEM.
// Pressing the siren or morse while one is active escalates it.

import type { PushMessage } from '$lib/server/apns';
import { distanceM } from '$lib/home/presence/geo';

export const ALARM_KINDS = ['siren', 'morse', 'quiet'] as const;
export type AlarmKind = (typeof ALARM_KINDS)[number];

export const ALARM_CATEGORY = 'family-alarm';
export const ALARM_CANCEL_CATEGORY = 'family-alarm-cancel';
export const MESSAGE_MAX = 140;
/** The longest place name kept from the phone (a Bat phone's "At …"). */
export const PLACE_MAX = 80;
/** An alarm is active for this long after it is raised, unless stood down. */
export const ACTIVE_MS = 30 * 60_000;
/** At most one NEW alarm per sender in this window. */
export const RAISE_GAP_MS = 30_000;

/** The sound file bundled in the app for each loud kind. The Bat phone uses the default sound. */
export const SOUND_FILE: Record<Exclude<AlarmKind, 'quiet'>, string> = { siren: 'sr-siren.caf', morse: 'sr-morse.caf' };

export interface AlarmPosition {
  lat: number;
  lon: number;
  accuracy: number | null;
}

export interface AlarmInput {
  kind: AlarmKind;
  message: string | null;
  position: AlarmPosition | null;
  /** The sender's battery, 0–1, when the phone said. */
  battery: number | null;
  /** Where the sender is, in words ("Elton Parade, Darlington"), when the phone said. */
  place: string | null;
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
  battery: number | null;
  place: string | null;
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
 * So are a battery outside 0–1 (iOS says -1 when it does not know) and a
 * place that is not text; a long place is cut to 80 characters.
 */
export function parseAlarmInput(body: unknown): AlarmInput | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind ?? 'siren';
  if (typeof kind !== 'string' || !(ALARM_KINDS as readonly string[]).includes(kind)) {
    return { error: 'kind must be "siren", "morse" or "quiet".' };
  }
  const text = typeof b.message === 'string' ? b.message.trim().slice(0, MESSAGE_MAX).trim() : '';
  let position: AlarmPosition | null = null;
  const p = b.position as Record<string, unknown> | null | undefined;
  if (p && typeof p === 'object' && finite(p.lat) && finite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
    position = { lat: p.lat, lon: p.lon, accuracy: finite(p.accuracy) && p.accuracy >= 0 ? p.accuracy : null };
  }
  const battery = finite(b.battery) && b.battery >= 0 && b.battery <= 1 ? b.battery : null;
  const place = typeof b.place === 'string' ? b.place.trim().slice(0, PLACE_MAX).trim() : '';
  return { kind: kind as AlarmKind, message: text || null, position, battery, place: place || null };
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

/** A loud alarm pressed while the sender's Bat phone is active: it must ring, not answer with the quiet one. */
export function escalates(active: Pick<AlarmRecord, 'kind'>, requested: AlarmKind): boolean {
  return active.kind === 'quiet' && requested !== 'quiet';
}

/**
 * Given the sender's most recent alarm (or none), what a press of `requested`
 * does now. The siren or morse pressed while their Bat phone is active is a
 * NEW alarm at once (no gap); every other press while one is active answers
 * with it.
 */
export function decideRaise(latest: AlarmRecord | null, now: Date, requested: AlarmKind = 'siren'): RaiseDecision {
  if (!latest) return { kind: 'new' };
  if (isActive(latest, now)) return escalates(latest, requested) ? { kind: 'new' } : { kind: 'existing', alarm: latest };
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

/** The alarm push (siren or morse; the Bat phone's is `quietPush`). Critical only when `critical` (APNS_CRITICAL_ALERTS=1). */
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

// ── The Bat phone (kind `quiet`) ─────────────────────────────────────────

/** A recipient's last fix counts for the drive estimate only when at most this old. */
export const POSITION_FRESH_MS = 6 * 3_600_000;
/** Roads are longer than the crow flies. */
export const ROAD_FACTOR = 1.3;

/**
 * Roughly how many minutes' drive from `from` to `to`: the great-circle
 * distance times ROAD_FACTOR, driven at 25 km/h for the first 5 km, 45 km/h
 * to 30 km and 70 km/h beyond — cumulative, so a longer trip never comes out
 * shorter. Rounded up, at least 1. The app works out the real ETA on open;
 * this is the line on the lock screen.
 */
export function estimateDriveMinutes(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const km = (distanceM(from.lat, from.lon, to.lat, to.lon) / 1000) * ROAD_FACTOR;
  const town = Math.min(km, 5);
  const country = Math.min(Math.max(km - 5, 0), 25);
  const motorway = Math.max(km - 30, 0);
  const minutes = (town / 25 + country / 45 + motorway / 70) * 60;
  return Math.max(1, Math.ceil(minutes - 1e-9));
}

/**
 * Each recipient's estimated drive to the alarm, by email, from their last
 * position — only a fix at most POSITION_FRESH_MS old, and only for someone
 * whose household subject is known. Nobody when the alarm has no position.
 */
export function driveMinutesByEmail(
  emails: readonly string[],
  to: { lat: number | null; lon: number | null },
  subjectOf: (email: string) => string | null,
  positions: ReadonlyArray<{ subject: string; lat: number; lon: number; at: string }>,
  now: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  if (to.lat === null || to.lon === null) return out;
  const target = { lat: to.lat, lon: to.lon };
  const fresh = new Map(
    positions.filter((p) => now.getTime() - Date.parse(p.at) <= POSITION_FRESH_MS).map((p) => [p.subject, p] as const),
  );
  for (const email of emails) {
    const subject = subjectOf(email);
    const at = subject ? fresh.get(subject) : undefined;
    if (at) out.set(email, estimateDriveMinutes(at, target));
  }
  return out;
}

/** "about 14 min drive from you", or "about 1 h 35 drive from you" from 90 minutes. */
export function driveText(minutes: number): string {
  if (minutes < 90) return `about ${minutes} min drive from you`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h} h${m ? ` ${m}` : ''} drive from you`;
}

/**
 * The Bat phone's body for one recipient: where they are, their battery and
 * the drive from the recipient, each left out when unknown — or, knowing none
 * of it, a plain "needs you". Their message, if any, on a line of its own.
 */
export function quietBody(input: {
  name: string;
  place: string | null;
  battery: number | null;
  driveMinutes: number | null;
  message: string | null;
}): string {
  const parts: string[] = [];
  if (input.place) parts.push(`At ${input.place}`);
  if (input.battery !== null) parts.push(`battery ${Math.round(input.battery * 100)}%`);
  if (input.driveMinutes !== null) parts.push(driveText(input.driveMinutes));
  const first = parts.length ? parts.join(' · ') : `${input.name} needs you. Open SR to see where they are.`;
  return input.message ? `${first}\n${input.message}` : first;
}

/**
 * The Bat phone push for ONE recipient (its body carries the drive from
 * them). Urgent but discreet: the ordinary notification sound, never the
 * siren — critical (at full volume) only when critical alerts are on.
 */
export function quietPush(alarm: AlarmRecord, fromId: string, critical: boolean, driveMinutes: number | null): PushMessage {
  return {
    title: `Bat phone — ${alarm.fromName}`,
    body: quietBody({ name: alarm.fromName, place: alarm.place, battery: alarm.battery, driveMinutes, message: alarm.message }),
    category: ALARM_CATEGORY,
    threadId: ALARM_CATEGORY,
    level: critical ? 'critical' : 'time-sensitive',
    sound: critical ? { critical: 1, name: 'default', volume: 1.0 } : 'default',
    relevance: 1,
    collapseId: `alarm-${alarm.id}`,
    ttlSeconds: ACTIVE_MS / 1000,
    userInfo: {
      category: ALARM_CATEGORY,
      alarmId: alarm.id,
      from: fromId,
      name: alarm.fromName,
      kind: 'quiet',
      lat: alarm.lat,
      lon: alarm.lon,
      battery: alarm.battery,
      place: alarm.place,
      at: alarm.createdAt.toISOString(),
    },
  };
}

/**
 * Every Bat phone push to send: one per drive estimate, so each recipient
 * reads the drive from THEM and people with the same text (the owner's
 * addresses, everyone without a fix) share one send.
 */
export function quietPushes(
  emails: readonly string[],
  alarm: AlarmRecord,
  fromId: string,
  critical: boolean,
  minutes: ReadonlyMap<string, number>,
): Array<{ emails: string[]; message: PushMessage }> {
  const groups = new Map<number | null, string[]>();
  for (const email of emails) {
    const m = minutes.get(email) ?? null;
    groups.set(m, [...(groups.get(m) ?? []), email]);
  }
  return [...groups].map(([m, group]) => ({ emails: group, message: quietPush(alarm, fromId, critical, m) }));
}

/** The Bat phone as a line in "msg family", so the family's history shows it. */
export function quietMessageBody(alarm: Pick<AlarmRecord, 'place' | 'battery' | 'message'>): string {
  const parts: string[] = [];
  if (alarm.place) parts.push(`at ${alarm.place}`);
  if (alarm.battery !== null) parts.push(`battery ${Math.round(alarm.battery * 100)}%`);
  const first = parts.length ? `🦇 Bat phone — ${parts.join(' · ')}` : '🦇 Bat phone';
  return alarm.message ? `${first}\n${alarm.message}` : first;
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
    battery: alarm.battery,
    place: alarm.place,
    at: alarm.createdAt.toISOString(),
    cancelledAt: alarm.cancelledAt?.toISOString() ?? null,
  };
}
