/**
 * The per-build credential: an HMAC over `<buildId>.<issuedAt>`.
 *
 * Extracted from `tool-bridge.ts` so it can be verified without importing the
 * site-tool registry. Anything checking a build's identity — the tool bridge,
 * the codegraph query endpoint — needs these fifteen lines and none of the
 * hundred-odd tool definitions behind them, and a security primitive that can
 * only be exercised by dragging half the platform into the test is one that
 * does not get exercised.
 *
 * Imports nothing but `node:crypto`. Keep it that way.
 */
import crypto from 'node:crypto';

function secret(): string {
  const value = process.env.JKAI_BRIDGE_SECRET;
  if (!value || value.length < 32) {
    throw new Error('JKAI_BRIDGE_SECRET must be set to a strong random value (>=32 chars)');
  }
  return value;
}

export function signBridgeToken(buildId: string): string {
  const payload = `${buildId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

/**
 * How long a token stays good after it is minted.
 *
 * A token is minted per ITERATION (`executeIteration`), and an iteration is
 * bounded at 30 minutes of wall clock by the pi runner — so eight hours is a
 * wide margin for the longest legitimate caller, not a tight one. What it
 * closes is a token that never expires: one lifted from a build's environment
 * or logs used to work for as long as the bridge secret did. The route-side
 * check that the build is still RUNNING (`$lib/jkai/bridge-auth.server`) is
 * the other half.
 */
export const BRIDGE_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** Clock skew tolerated on a token that claims to come from the future. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** The build this token was issued to, or null if it is not a valid token. */
export function verifyBridgeToken(token: string, now: number = Date.now()): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [buildId, ts, sig] = parts;
    const expected = crypto.createHmac('sha256', secret()).update(`${buildId}.${ts}`).digest('hex');
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const issuedAt = Number(ts);
    if (!Number.isFinite(issuedAt)) return null;
    if (now - issuedAt > BRIDGE_TOKEN_MAX_AGE_MS || issuedAt - now > FUTURE_SKEW_MS) return null;
    return buildId;
  } catch {
    return null;
  }
}

/** The build named by a `Bearer <token>` header, or null. */
export function buildFromAuthHeader(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m ? verifyBridgeToken(m[1].trim()) : null;
}
