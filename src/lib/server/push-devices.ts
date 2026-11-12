import { familyRole } from './family-access';
/**
 * Which phones a push can reach, and pushing to a person rather than a token.
 *
 * A token lives on the phone's site credential (`native_credentials`), not in a
 * table of its own, so revoking a phone on /admin/access/devices stops its
 * pushes in the same write and an expired pairing is never pushed to. The cost
 * is that only a phone with a SITE pairing can be pushed to: a family member on
 * the companion lane alone (health and location, no chat, news or games) still
 * gets their household alerts by the app's pull, exactly as before.
 *
 * Addressed by EMAIL, the identity every caller already holds: the owner's
 * allow-list, a game player's roster entry, a household follower.
 */

import { and, eq, gt, inArray, isNotNull, isNull, like, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, nativeCredentials } from '$lib/db/schema';
import { isDeadToken, isDeviceToken, sendPush, type ApnsEnv, type ApnsResult, type NotifyLevel, type PushMessage } from './apns';
import { isOwnerEmail } from './access';

export interface PushTarget {
  id: string;
  ownerEmail: string;
  apnsToken: string;
  apnsEnv: string | null;
  notificationDetails?: boolean;
  /** Their owner's setting; absent is the default, `minimal`. */
  notifyLevel?: NotifyLevel;
}

export interface PushOutcome {
  /**
   * Lower-cased emails this push is finished with: at least one of their
   * phones took it, or they have chosen not to hear this tier. Either way it
   * must not be retried or handed to the app's pull queue.
   */
  reached: Set<string>;
  sent: number;
  failed: number;
  /** Phones skipped because their owner's level is quieter than the message's tier. */
  muted: number;
}

// ── How much a person hears ──────────────────────────────────────────────────
//
// One setting per PERSON (their email), not per phone: a second phone or a
// re-pairing keeps it. In app_settings, like the other per-person keys, so it
// needs no schema change. Everyone starts on `minimal` and turns it up in the
// app (Settings → Notifications).

export const NOTIFY_LEVELS: readonly NotifyLevel[] = ['minimal', 'normal', 'verbose'];
export const DEFAULT_NOTIFY_LEVEL: NotifyLevel = 'minimal';
const LEVEL_KEY_PREFIX = 'notify.level.';
const levelKey = (email: string) => `${LEVEL_KEY_PREFIX}${email.trim().toLowerCase()}`;

export function isNotifyLevel(value: unknown): value is NotifyLevel {
  return typeof value === 'string' && (NOTIFY_LEVELS as readonly string[]).includes(value);
}

/** Whether somebody on `level` hears `message`. A silent background push shows nothing, so always. PURE. */
export function hears(level: NotifyLevel | undefined, message: Pick<PushMessage, 'tier' | 'background'>): boolean {
  if (message.background) return true;
  return NOTIFY_LEVELS.indexOf(level ?? DEFAULT_NOTIFY_LEVEL) >= NOTIFY_LEVELS.indexOf(message.tier ?? 'normal');
}

/** Everybody's stored level, by lower-cased email. Whoever is absent is on the default. */
async function notifyLevels(): Promise<Map<string, NotifyLevel>> {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${LEVEL_KEY_PREFIX}%`));
  const out = new Map<string, NotifyLevel>();
  for (const r of rows) if (isNotifyLevel(r.value)) out.set(r.key.slice(LEVEL_KEY_PREFIX.length), r.value);
  return out;
}

export async function notifyLevelOf(email: string): Promise<NotifyLevel> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, levelKey(email))).limit(1);
  return isNotifyLevel(row?.value) ? row.value : DEFAULT_NOTIFY_LEVEL;
}

export async function setNotifyLevel(email: string, level: NotifyLevel): Promise<void> {
  await db.insert(appSettings).values({ key: levelKey(email), value: level })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: level, updatedAt: new Date() } });
}

export type PushSender = (token: string, message: PushMessage, env?: ApnsEnv | null) => Promise<ApnsResult>;

/**
 * Store this phone's token. The same token on any OTHER row is cleared: a phone
 * re-paired keeps its APNs token, and two live rows holding it would ring it
 * twice for every alert.
 */
export async function registerPushToken(deviceId: string, token: string, env: ApnsEnv): Promise<void> {
  if (!isDeviceToken(token)) throw new Error('Not an APNs device token.');
  const value = token.toLowerCase();
  await db
    .update(nativeCredentials)
    .set({ apnsToken: null, apnsEnv: null, apnsTokenAt: null })
    .where(and(eq(nativeCredentials.apnsToken, value), ne(nativeCredentials.id, deviceId)));
  await db
    .update(nativeCredentials)
    .set({ apnsToken: value, apnsEnv: env, apnsTokenAt: new Date() })
    .where(eq(nativeCredentials.id, deviceId));
}

export async function clearPushToken(deviceId: string): Promise<void> {
  await db
    .update(nativeCredentials)
    .set({ apnsToken: null, apnsEnv: null, apnsTokenAt: null })
    .where(eq(nativeCredentials.id, deviceId));
}

/** Live, unrevoked device rows with a token, for these emails (or all, when null). */
async function targets(emails: readonly string[] | null): Promise<PushTarget[]> {
  const rows = await db
    .select({
      id: nativeCredentials.id,
      ownerEmail: nativeCredentials.ownerEmail,
      apnsToken: nativeCredentials.apnsToken,
      apnsEnv: nativeCredentials.apnsEnv,
      notificationDetails: nativeCredentials.notificationDetails,
    })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.kind, 'device'),
        isNull(nativeCredentials.revokedAt),
        gt(nativeCredentials.expiresAt, new Date()),
        isNotNull(nativeCredentials.apnsToken),
        emails ? inArray(nativeCredentials.ownerEmail, [...emails]) : undefined,
      ),
    );
  const live = rows.filter((r): r is typeof r & { apnsToken: string } => !!r.apnsToken);
  if (!live.length) return live;
  const levels = await notifyLevels();
  return live.map((r) => ({ ...r, notifyLevel: levels.get(r.ownerEmail.trim().toLowerCase()) }));
}

/**
 * Send to each target; forget a token Apple says is dead. PURE apart from the
 * sender and the `forget` it is handed, so the bookkeeping is testable.
 */
export async function deliver(
  list: readonly PushTarget[],
  message: PushMessage,
  send: PushSender,
  forget: (deviceId: string) => Promise<void>,
): Promise<PushOutcome> {
  const outcome: PushOutcome = { reached: new Set(), sent: 0, failed: 0, muted: 0 };
  for (const t of list) {
    // Not for this person at their level: done with, and never sent.
    if (!hears(t.notifyLevel, message)) {
      outcome.muted++;
      outcome.reached.add(t.ownerEmail.trim().toLowerCase());
      continue;
    }
    const env = t.apnsEnv === 'sandbox' ? 'sandbox' : t.apnsEnv === 'production' ? 'production' : null;
    const result = await send(t.apnsToken, t.notificationDetails === true ? message : privatePush(message), env);
    if (result.ok) {
      outcome.sent++;
      outcome.reached.add(t.ownerEmail.trim().toLowerCase());
      continue;
    }
    outcome.failed++;
    console.warn(`[push] device ${t.id.slice(0, 8)} refused: ${result.status} ${result.reason ?? ''}`);
    if (isDeadToken(result)) await forget(t.id).catch(() => {});
  }
  // One line per push, so "did it go?" is answerable from the journal.
  if (list.length) {
    const what = message.category ?? message.userInfo?.category ?? (message.background ? 'background' : 'alert');
    console.log(`[push] ${what}: ${outcome.sent} sent, ${outcome.failed} refused, ${outcome.muted} muted (${message.tier ?? 'normal'}), ${list.length} phone${list.length === 1 ? '' : 's'}`);
  }
  return outcome;
}

/**
 * The family alarm's private preview. A phone that hides details still has to
 * RING: the sound, its loudness and how long Apple keeps trying survive, and so
 * do the ids the app needs to fetch the rest. The name, message and position do
 * not — the app reads those from `GET /api/native/family/alarm` once opened.
 */
const ALARM_PRIVATE: Record<string, { title: string; body: string }> = {
  'family-alarm': { title: 'Family alarm', body: 'Someone in the family raised the alarm. Open the app to see who and where.' },
  'family-alarm-cancel': { title: 'Family alarm stood down', body: 'Open the app for details.' },
  // "msg family": the reply buttons still work on a private preview, so the
  // message's id survives; who wrote it and what it says do not.
  'family-msg': { title: 'Family message', body: 'Someone in the family sent a message. Open the app to read it.' },
  'family-msg-reply': { title: 'Family message', body: 'Someone replied to your message. Open the app to read it.' },
  // A build the owner sent this phone: nothing private in it, and the app asks
  // the site which build when it opens.
  'app-update': { title: 'A new version of SR', body: 'Open SR to install it.' },
};
/**
 * The Bat phone: a `family-msg` of kind `bat-phone` since 2026-10-27, a
 * `family-alarm` of kind `quiet` before. Discreet, and still says it is urgent.
 */
const BAT_PHONE_PRIVATE = { title: 'Bat phone', body: 'Someone in the family needs you. Open the app to see who and where.' };
/**
 * Game pushes: the invite must still arrive time-sensitive and for as long as
 * its lobby is open, or a phone hiding details never hears it. The room id
 * survives so a tap opens the lobby; who is playing does not.
 */
const GAME_PRIVATE: Record<string, { title: string; body: string }> = {
  invite: { title: 'Game invite', body: 'Someone in the family invited you to a game. Tap to join.' },
  turn: { title: 'Your move', body: 'It is your turn in a game. Open the app to play.' },
  finished: { title: 'A game is over', body: 'Open the app to see who won.' },
};
const ALARM_KEYS = ['alarmId', 'kind', 'at', 'messageId', 'roomId', 'game'] as const;

/** Keep names, counts, locations and arbitrary metadata off private previews. */
export function privatePush(message: PushMessage): PushMessage {
  // A silent background push shows nothing on the lock screen, so there is no
  // preview to keep private — and turning it into an alert would make it ring.
  if (message.background) return message;
  const userInfo: Record<string, string | number | null> = {};
  if (message.userInfo?.category) userInfo.category = message.userInfo.category;
  if (message.userInfo?.url) userInfo.url = message.userInfo.url;
  const kind = message.userInfo?.kind;
  const batPhone =
    (message.category === 'family-alarm' && kind === 'quiet') || (message.category === 'family-msg' && kind === 'bat-phone');
  const alarm = batPhone
    ? BAT_PHONE_PRIVATE
    : message.category === 'game'
      ? GAME_PRIVATE[typeof kind === 'string' ? kind : 'invite'] ?? GAME_PRIVATE.invite
      : message.category ? ALARM_PRIVATE[message.category] : undefined;
  if (alarm) {
    for (const key of ALARM_KEYS) if (message.userInfo?.[key] != null) userInfo[key] = message.userInfo[key];
    return { ...alarm, category: message.category, threadId: message.threadId, collapseId: message.collapseId,
      level: message.level, sound: message.sound, relevance: message.relevance, ttlSeconds: message.ttlSeconds, userInfo };
  }
  return { title: 'Strange Ramblings', body: 'You have an update. Open the app to view it.',
    category: message.category, threadId: message.threadId, collapseId: message.collapseId,
    // Only the words are private. How urgent it is and how long Apple keeps
    // trying are not, and dropping them lost pushes to a sleeping phone.
    level: message.level, sound: message.sound, relevance: message.relevance, ttlSeconds: message.ttlSeconds, userInfo };
}

export async function devicePushPrivacy(deviceId: string, update?: { notificationDetails: boolean; liveActivityEnabled: boolean }) {
  if (update) await db.update(nativeCredentials).set(update).where(eq(nativeCredentials.id, deviceId));
  const [row] = await db.select({ notificationDetails: nativeCredentials.notificationDetails,
    liveActivityEnabled: nativeCredentials.liveActivityEnabled, ownerEmail: nativeCredentials.ownerEmail }).from(nativeCredentials).where(eq(nativeCredentials.id,deviceId)).limit(1);
  if (!row) return { notificationDetails: false, liveActivityEnabled: false, notifyLevel: DEFAULT_NOTIFY_LEVEL };
  return { notificationDetails: row.notificationDetails, liveActivityEnabled: row.liveActivityEnabled, notifyLevel: await notifyLevelOf(row.ownerEmail) };
}

/** Push to every phone these people hold. Never throws. */
export async function pushToEmails(
  emails: readonly string[],
  message: PushMessage,
  send: PushSender = sendPush,
): Promise<PushOutcome> {
  let wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  try {
    if (message.category === 'household' || message.category?.startsWith('family-')) {
      wanted = (await Promise.all(wanted.map(async e => await familyRole(e) ? e : null))).filter((e): e is string => e !== null);
    }
    if (message.category === 'family-steps' && !message.authorizeTargets) {
      return { reached: new Set(), sent: 0, failed: 0, muted: 0 };
    }
    if (message.authorizeTargets) {
      const permitted = new Set(await message.authorizeTargets(wanted));
      wanted = wanted.filter(email => permitted.has(email));
    }
    if (!wanted.length) return { reached: new Set(), sent: 0, failed: 0, muted: 0 };
    return await deliver(await targets(wanted), message, send, clearPushToken);
  } catch (error) {
    console.error('[push] could not push:', (error as Error).message);
    return { reached: new Set(), sent: 0, failed: 0, muted: 0 };
  }
}

/** Push to the owner's phones: every allow-listed email's. Never throws. */
export async function pushToOwner(message: PushMessage, send: PushSender = sendPush): Promise<PushOutcome> {
  try {
    const owners = (await targets(null)).filter((t) => isOwnerEmail(t.ownerEmail));
    return await deliver(owners, message, send, clearPushToken);
  } catch (error) {
    console.error('[push] could not push to the owner:', (error as Error).message);
    return { reached: new Set(), sent: 0, failed: 0, muted: 0 };
  }
}

/**
 * Push to ONE phone, by its site credential: a build the owner sent it from
 * /admin/access/app. Null when the phone is not live or holds no token. The
 * phone's own preview setting applies, as for any other push.
 */
export async function pushToDevice(deviceId: string, message: PushMessage, send: PushSender = sendPush): Promise<ApnsResult | null> {
  const [row] = await db
    .select({
      id: nativeCredentials.id,
      ownerEmail: nativeCredentials.ownerEmail,
      apnsToken: nativeCredentials.apnsToken,
      apnsEnv: nativeCredentials.apnsEnv,
      notificationDetails: nativeCredentials.notificationDetails,
    })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.id, deviceId),
        eq(nativeCredentials.kind, 'device'),
        isNull(nativeCredentials.revokedAt),
        gt(nativeCredentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row?.apnsToken) return null;
  let result: ApnsResult | null = null;
  await deliver(
    [{ ...row, apnsToken: row.apnsToken, notifyLevel: await notifyLevelOf(row.ownerEmail) }],
    message,
    async (token, m, env) => (result = await send(token, m, env)),
    clearPushToken,
  );
  return result;
}

/** One "it works" notification to this phone. Null when it holds no token. */
export async function pushTestTo(deviceId: string, send: PushSender = sendPush): Promise<ApnsResult | null> {
  const [row] = await db
    .select({ token: nativeCredentials.apnsToken, env: nativeCredentials.apnsEnv })
    .from(nativeCredentials)
    .where(eq(nativeCredentials.id, deviceId))
    .limit(1);
  if (!row?.token) return null;
  return send(
    row.token,
    {
      title: 'Notifications are working',
      body: 'Sent from strangeramblings.com just now.',
      category: 'sr.alert',
      threadId: 'system',
      userInfo: { category: 'system' },
    },
    row.env === 'sandbox' ? 'sandbox' : 'production',
  );
}
