/**
 * Apple Push Notification service: one message to one phone.
 *
 * ## Why this exists
 *
 * Until 2026-09-28 nothing on this site could wake a phone. The app pulled —
 * a background refresh iOS runs when it likes, a five-second poll while the
 * Games tab is open — so an alert was minutes or hours late, and a game invite
 * reached nobody whose app was closed. The key (`Q724VRDR3J`) and a profile
 * carrying `aps-environment` arrived on 2026-09-27; this is the sender.
 *
 * ## The shape
 *
 * Token-based auth (a `.p8` key, not a certificate): one ES256 JWT signs every
 * request and covers every app on the team. Apple wants it refreshed no more
 * often than every 20 minutes and no less often than every 60, so it is cached
 * for 50. HTTP/2 is Apple's only transport, and it wants ONE long-lived
 * connection per host rather than one per message — opening a connection per
 * push is how a sender gets throttled — so each host keeps a session that is
 * re-opened when it closes.
 *
 * **This never throws.** Every caller is already doing something else — raising
 * an alert, starting a game — and a push that fails is a push that did not go,
 * which the caller can see from the result and fall back from.
 *
 * Configuration, all from the VPS `.env` (escrowed in `homeserv-recovery`):
 * `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_BASE64` (the .p8,
 * base64) and `APNS_ENV` (the gateway for a token that did not say).
 */

import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export type ApnsEnv = 'production' | 'sandbox';

/** How loudly. `time-sensitive` breaks through a Focus; the app must hold the entitlement. */
export type InterruptionLevel = 'passive' | 'active' | 'time-sensitive';

export interface PushMessage {
  title: string;
  body: string;
  /** The app's `UNNotificationCategory` identifier — which buttons it wears. */
  category?: string;
  /** Groups notifications in Notification Centre. */
  threadId?: string;
  level?: InterruptionLevel;
  /** 0–1: where it ranks in a notification summary. */
  relevance?: number;
  /** A later push with the same id REPLACES this one on the phone. ≤ 64 bytes. */
  collapseId?: string;
  /** Read by the app's tap and button handlers. Keys beside `aps`. */
  userInfo?: Record<string, string>;
  /** Seconds Apple keeps trying a phone that is off. 0 = once, now. */
  ttlSeconds?: number;
  /** Server-only: people whose step totals/names appear in this message. Never sent to APNs. */
  stepsConsentEmails?: readonly string[];
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** Apple's reason when not ok, e.g. `BadDeviceToken`, `Unregistered`. */
  reason?: string;
}

interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: KeyObject;
  defaultEnv: ApnsEnv;
}

const HOSTS: Record<ApnsEnv, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

/** Apple's limit for an alert payload. */
const MAX_PAYLOAD_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 10_000;
const JWT_TTL_MS = 50 * 60_000;

let cachedConfig: ApnsConfig | null | undefined;

/** The key and ids, or null when this process is not configured to push. */
export function apnsConfig(): ApnsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();
  const raw = process.env.APNS_KEY_BASE64?.trim();
  if (!keyId || !teamId || !bundleId || !raw) {
    cachedConfig = null;
    return null;
  }
  try {
    const key = createPrivateKey(Buffer.from(raw, 'base64').toString('utf8'));
    cachedConfig = {
      keyId,
      teamId,
      bundleId,
      key,
      defaultEnv: process.env.APNS_ENV?.trim() === 'sandbox' ? 'sandbox' : 'production',
    };
  } catch (error) {
    console.error('[apns] APNS_KEY_BASE64 is not a readable key:', (error as Error).message);
    cachedConfig = null;
  }
  return cachedConfig;
}

export function isApnsConfigured(): boolean {
  return apnsConfig() !== null;
}

let jwt: { token: string; at: number } | null = null;

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** The provider token. ES256, `ieee-p1363` so the signature is raw r‖s as JWS wants. */
function providerToken(config: ApnsConfig, now = Date.now()): string {
  if (jwt && now - jwt.at < JWT_TTL_MS) return jwt.token;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = b64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: config.key,
    dsaEncoding: 'ieee-p1363',
  });
  jwt = { token: `${header}.${claims}.${b64url(signature)}`, at: now };
  return jwt.token;
}

/**
 * The JSON Apple delivers. PURE, so what reaches a lock screen is testable.
 *
 * Title and body are trimmed to fit: Apple refuses a payload over 4 KB outright,
 * and a notification that is cut short is better than one that never arrives.
 */
export function buildPayload(message: PushMessage): string {
  const aps: Record<string, unknown> = {
    alert: { title: message.title.slice(0, 200), body: message.body.slice(0, 1000) },
    sound: message.level === 'passive' ? undefined : 'default',
    'interruption-level': message.level ?? 'active',
  };
  if (message.category) aps.category = message.category;
  if (message.threadId) aps['thread-id'] = message.threadId;
  if (message.relevance !== undefined) aps['relevance-score'] = Math.min(Math.max(message.relevance, 0), 1);
  const payload = JSON.stringify({ ...(message.userInfo ?? {}), aps });
  if (Buffer.byteLength(payload) <= MAX_PAYLOAD_BYTES) return payload;
  return JSON.stringify({
    ...(message.userInfo ?? {}),
    aps: { ...aps, alert: { title: message.title.slice(0, 100), body: message.body.slice(0, 300) } },
  });
}

/** A token as Apple issues it: hex. Anything else is refused before it costs a request. */
export function isDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64,200}$/i.test(value);
}

/** Whether Apple's answer means this token will never work again — forget it. */
export function isDeadToken(result: ApnsResult): boolean {
  return (
    result.status === 410 ||
    result.reason === 'BadDeviceToken' ||
    result.reason === 'DeviceTokenNotForTopic' ||
    result.reason === 'Unregistered'
  );
}

const sessions = new Map<ApnsEnv, ClientHttp2Session>();

function sessionFor(env: ApnsEnv): ClientHttp2Session {
  const open = sessions.get(env);
  if (open && !open.closed && !open.destroyed) return open;
  const session = connect(HOSTS[env]);
  // An idle connection must not keep the process alive at shutdown.
  session.unref();
  const drop = () => {
    if (sessions.get(env) === session) sessions.delete(env);
  };
  session.on('error', (error) => {
    console.error(`[apns] ${env} connection error:`, error.message);
    drop();
  });
  session.on('close', drop);
  session.on('goaway', drop);
  sessions.set(env, session);
  return session;
}

/** Send one push. Never throws. */
export async function sendPush(
  deviceToken: string,
  message: PushMessage,
  env?: ApnsEnv | null,
): Promise<ApnsResult> {
  const passive = message.level === 'passive';
  const headers: Record<string, string> = {
    'apns-push-type': 'alert',
    // 5 lets iOS batch a passive one with the next wake; 10 is "now".
    'apns-priority': passive ? '5' : '10',
    'apns-expiration': String(
      message.ttlSeconds === 0 ? 0 : Math.floor(Date.now() / 1000) + (message.ttlSeconds ?? 3600),
    ),
  };
  if (message.collapseId) headers['apns-collapse-id'] = message.collapseId.slice(0, 64);
  return post(deviceToken, headers, buildPayload(message), env, '');
}

/**
 * One Live Activity push: a push-to-start token, or one activity's own update
 * token. `aps` is ActivityKit's (`event`, `content-state`, `timestamp`, …) and
 * is passed through as built by the caller. Never throws.
 *
 * The topic is the app's bundle id with `.push-type.liveactivity`, and the
 * push type `liveactivity`; the same key signs it.
 */
export async function sendLiveActivity(
  token: string,
  aps: Record<string, unknown>,
  env?: ApnsEnv | null,
  priority: 5 | 10 = 10,
): Promise<ApnsResult> {
  const headers: Record<string, string> = {
    'apns-push-type': 'liveactivity',
    'apns-priority': String(priority),
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 15 * 60),
  };
  return post(token, headers, JSON.stringify({ aps }), env, '.push-type.liveactivity');
}

async function post(
  deviceToken: string,
  extra: Record<string, string>,
  body: string,
  env: ApnsEnv | null | undefined,
  topicSuffix: string,
): Promise<ApnsResult> {
  const config = apnsConfig();
  if (!config) return { ok: false, status: 0, reason: 'NotConfigured' };
  if (!isDeviceToken(deviceToken)) return { ok: false, status: 0, reason: 'BadDeviceToken' };
  const target = env ?? config.defaultEnv;

  const headers: Record<string, string> = {
    [constants.HTTP2_HEADER_METHOD]: 'POST',
    [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
    authorization: `bearer ${providerToken(config)}`,
    'apns-topic': config.bundleId + topicSuffix,
    ...extra,
  };

  try {
    return await new Promise<ApnsResult>((resolve) => {
      let settled = false;
      const done = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const request = sessionFor(target).request(headers);
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.close(constants.NGHTTP2_CANCEL);
        done({ ok: false, status: 0, reason: 'Timeout' });
      });
      let status = 0;
      let text = '';
      request.on('response', (h) => {
        status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0;
      });
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        text += chunk;
      });
      request.on('end', () => {
        if (status === 200) return done({ ok: true, status });
        let reason: string | undefined;
        try {
          reason = (JSON.parse(text) as { reason?: string }).reason;
        } catch {
          reason = undefined;
        }
        done({ ok: false, status, reason });
      });
      request.on('error', (error) => done({ ok: false, status: 0, reason: error.message.slice(0, 120) }));
      request.end(body);
    });
  } catch (error) {
    return { ok: false, status: 0, reason: (error as Error).message.slice(0, 120) };
  }
}

/** For tests: forget the cached key, token and connections. */
export function resetApnsForTests(): void {
  cachedConfig = undefined;
  jwt = null;
  for (const s of sessions.values()) s.destroy();
  sessions.clear();
}
