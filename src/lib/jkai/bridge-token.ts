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

/** The build this token was issued to, or null if it is not a valid token. */
export function verifyBridgeToken(token: string): string | null {
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
