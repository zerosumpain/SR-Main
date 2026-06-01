import { createHmac, timingSafeEqual } from 'node:crypto';

// `skill` pins a specific jkai domain skill for the turn — the skill name rides
// in `kindId` (validated server-side against the pickable-skills allowlist).
// NOTE: this enum MUST stay in sync with VALID_KINDS in the Hermes plugin's
// auth.py (the inbound verifier) — a kind accepted by one but not the other
// produces a 403 on every message of that kind.
export type TokenKind = 'build' | 'canvas_chat' | 'manual' | 'skill';

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

const VALID_KINDS: TokenKind[] = ['build', 'canvas_chat', 'manual', 'skill'];

function encodePayload(scope: TokenScope): string {
  return Buffer.from(
    JSON.stringify({
      sessionId: scope.sessionId,
      kind: scope.kind,
      kindId: scope.kindId,
      expiresAt: scope.expiresAt,
    }),
    'utf8',
  ).toString('base64url');
}

function decodePayload(encoded: string): TokenScope | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.kind !== 'string' ||
      typeof parsed.kindId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      !VALID_KINDS.includes(parsed.kind)
    )
      return null;
    return parsed as TokenScope;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function mintBridgeToken(scope: TokenScope, secret: string): string {
  const encoded = encodePayload(scope);
  const sig = sign(encoded, secret);
  return encoded + SEPARATOR + sig;
}

// Public: read the token's claimed scope WITHOUT verifying the signature.
// Use only for scope-binding decisions (e.g. inferring sessionId before
// passing the token+expected scope to verifyBridgeToken). The signature
// check is still mandatory before trusting any payload contents.
export function peekTokenPayload(token: string): TokenScope | null {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;
  return decodePayload(parts[0]);
}

export function verifyBridgeToken(
  token: string,
  expectedScope: TokenScope,
  secret: string,
): VerifyResult {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [encodedPayload, sig] = parts;
  if (!encodedPayload || !sig) return { ok: false, reason: 'malformed' };

  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  const scope = decodePayload(encodedPayload);
  if (!scope) return { ok: false, reason: 'malformed' };

  if (
    scope.sessionId !== expectedScope.sessionId ||
    scope.kind !== expectedScope.kind ||
    scope.kindId !== expectedScope.kindId
  ) {
    return { ok: false, reason: 'scope_mismatch' };
  }

  if (Number.isNaN(scope.expiresAt) || Date.now() > scope.expiresAt) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, scope };
}
