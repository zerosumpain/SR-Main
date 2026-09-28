import { familyRole, familyRoster } from '$lib/family/roster.server';
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

import { and, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { nativeCredentials } from '$lib/db/schema';
import { isDeadToken, isDeviceToken, sendPush, type ApnsEnv, type ApnsResult, type PushMessage } from './apns';
import { isOwnerEmail } from './access';

export interface PushTarget {
  id: string;
  ownerEmail: string;
  apnsToken: string;
  apnsEnv: string | null;
}

export interface PushOutcome {
  /** Lower-cased emails at least one of whose phones Apple accepted it for. */
  reached: Set<string>;
  sent: number;
  failed: number;
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
  return rows.filter((r): r is PushTarget => !!r.apnsToken);
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
  const outcome: PushOutcome = { reached: new Set(), sent: 0, failed: 0 };
  for (const t of list) {
    const env = t.apnsEnv === 'sandbox' ? 'sandbox' : t.apnsEnv === 'production' ? 'production' : null;
    const result = await send(t.apnsToken, message, env);
    if (result.ok) {
      outcome.sent++;
      outcome.reached.add(t.ownerEmail.trim().toLowerCase());
      continue;
    }
    outcome.failed++;
    console.warn(`[push] device ${t.id.slice(0, 8)} refused: ${result.status} ${result.reason ?? ''}`);
    if (isDeadToken(result)) await forget(t.id).catch(() => {});
  }
  return outcome;
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
    if (message.category === 'family-steps') {
      const permitted = new Set((await familyRoster()).filter(p => p.stepsSharing === true).map(p => p.email));
      // Recheck both the recipient and every person disclosed by this message.
      // An opt-out during a long refresh must suppress the already-built payload.
      if (!message.stepsConsentEmails?.length || message.stepsConsentEmails.some(e => !permitted.has(e.trim().toLowerCase()))) {
        return { reached: new Set(), sent: 0, failed: 0 };
      }
      wanted = wanted.filter(e => permitted.has(e));
    }
    if (!wanted.length) return { reached: new Set(), sent: 0, failed: 0 };
    return await deliver(await targets(wanted), message, send, clearPushToken);
  } catch (error) {
    console.error('[push] could not push:', (error as Error).message);
    return { reached: new Set(), sent: 0, failed: 0 };
  }
}

/** Push to the owner's phones: every allow-listed email's. Never throws. */
export async function pushToOwner(message: PushMessage, send: PushSender = sendPush): Promise<PushOutcome> {
  try {
    const owners = (await targets(null)).filter((t) => isOwnerEmail(t.ownerEmail));
    return await deliver(owners, message, send, clearPushToken);
  } catch (error) {
    console.error('[push] could not push to the owner:', (error as Error).message);
    return { reached: new Set(), sent: 0, failed: 0 };
  }
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
