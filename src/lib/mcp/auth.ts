import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'build' | 'canvas_chat' | 'curate' | 'manual';

export interface TokenScope {
  sessionId: string;
  kind: TokenKind;
  kindId: string;
  expiresAt: number; // epoch ms
}

export type VerifyResult =
  | { ok: true; scope: TokenScope }
  | { ok: false; reason: 'malformed' | 'signature_mismatch' | 'scope_mismatch' | 'expired' };

const SEPARATOR = '.';

function payloadString(scope: TokenScope): string {
  return [scope.sessionId, scope.kind, scope.kindId, String(scope.expiresAt)].join('|');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function mintBridgeToken(scope: TokenScope, secret: string): string {
  const payload = payloadString(scope);
  const sig = sign(payload, secret);
  return Buffer.from(payload, 'utf8').toString('base64url') + SEPARATOR + sig;
}

export function verifyBridgeToken(
  token: string,
  expectedScope: TokenScope,
  secret: string,
): VerifyResult {
  const [encodedPayload, sig] = token.split(SEPARATOR);
  if (!encodedPayload || !sig) return { ok: false, reason: 'malformed' };

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const expectedSig = sign(payload, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  const [sessionId, kind, kindId, expiresAtStr] = payload.split('|');
  const expiresAt = Number(expiresAtStr);

  if (
    sessionId !== expectedScope.sessionId ||
    kind !== expectedScope.kind ||
    kindId !== expectedScope.kindId
  ) {
    return { ok: false, reason: 'scope_mismatch' };
  }

  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, scope: { sessionId, kind: kind as TokenKind, kindId, expiresAt } };
}
