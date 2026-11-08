// A page in the iPhone app's web view, signed in as the phone's owner.
//
// The app shows some applications' own pages full-screen — Wildmind's valley
// first (SR-AppleApp `Wildmind/WildmindWorldScreen.swift`). The phone holds a
// device credential, not a browser session, and a web view's requests (the
// page, its scripts, its websocket) cannot carry a bearer header. So the phone
// asks `POST /api/native/wildmind/web-session` for a cookie, puts it in the web
// view's cookie store, and the application's call to the session authority
// (`POST /api/internal/session`) carries it like any other cookie.
//
// The authority answers with the owner's email for it only when:
//  - the MAC (AUTH_SECRET) binds the audience, email, device and expiry;
//  - it was minted for the audience now asking — a Wildmind cookie tells Drive
//    nothing;
//  - it has not expired (`APP_WEB_SESSION_TTL_S`);
//  - the device credential it came from is still live, so revoking the phone
//    ends its web sessions on the next uncached question;
//  - the email is still an owner's.
//
// It is never a Main session: the hook does not read it, and only the
// audiences in `APP_WEB_AUDIENCES` accept it.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const APP_WEB_SESSION_COOKIE = 'sr_app_session';
/** Twelve hours: the app mints a fresh one each time the page is opened. */
export const APP_WEB_SESSION_TTL_S = 12 * 60 * 60;

/** The audiences whose pages the app shows, and the path their cookie is scoped to. */
export const APP_WEB_AUDIENCES: Readonly<Record<string, { path: string }>> = Object.freeze({
  'sr-wildmind': { path: '/wildmind' },
});

export interface AppWebSession {
  audience: string;
  email: string;
  deviceId: string;
  /** Unix ms. */
  expiresAt: number;
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`app-web-session:${body}`).digest('base64url');
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

/** The cookie value: `v1.<audience>.<email>.<device>.<expiry ms>.<mac>`, each text field base64url. */
export function signAppWebSession(
  secret: string,
  session: { audience: string; email: string; deviceId: string },
  now = Date.now(),
): { value: string; expiresAt: number } {
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot sign an app web session');
  if (!Object.hasOwn(APP_WEB_AUDIENCES, session.audience)) throw new Error(`no app web session for ${session.audience}`);
  const expiresAt = now + APP_WEB_SESSION_TTL_S * 1000;
  const body = ['v1', b64(session.audience), b64(session.email.trim().toLowerCase()), b64(session.deviceId), String(expiresAt)].join('.');
  return { value: `${body}.${mac(secret, body)}`, expiresAt };
}

/** The session in a value this server signed for `audience` that has not expired, or null. */
export function verifyAppWebSession(
  secret: string,
  audience: string,
  value: string | undefined | null,
  now = Date.now(),
): AppWebSession | null {
  if (!secret || !value || value.length > 1024) return null;
  const parts = value.split('.');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const body = parts.slice(0, 5).join('.');
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(parts[5]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(parts[4]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const session = { audience: unb64(parts[1]), email: unb64(parts[2]), deviceId: unb64(parts[3]), expiresAt };
  if (session.audience !== audience || !Object.hasOwn(APP_WEB_AUDIENCES, audience)) return null;
  if (!session.email.includes('@') || !session.deviceId) return null;
  return session;
}

/** The app session cookie's value in a cookie header, or ''. */
export function appWebSessionCookie(header: string): string {
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === APP_WEB_SESSION_COOKIE) return part.slice(at + 1).trim();
  }
  return '';
}
