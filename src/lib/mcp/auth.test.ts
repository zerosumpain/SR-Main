import { describe, it, expect, beforeAll } from 'vitest';
import { mintBridgeToken, verifyBridgeToken, type TokenScope } from './auth';

const SECRET = 'test-secret-do-not-use-in-prod-32-bytes-please';

describe('mcp/auth bridge tokens', () => {
  const scope: TokenScope = {
    sessionId: 'sess_abc',
    kind: 'canvas_chat',
    kindId: 'wf_42',
    expiresAt: Date.now() + 60_000,
  };

  it('mints a token that verifies under matching scope', () => {
    const token = mintBridgeToken(scope, SECRET);
    const result = verifyBridgeToken(token, scope, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects a token whose kind_id does not match the call target', () => {
    const token = mintBridgeToken(scope, SECRET);
    const wrongTarget: TokenScope = { ...scope, kindId: 'wf_99' };
    const result = verifyBridgeToken(token, wrongTarget, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope_mismatch');
  });

  it('rejects a token whose kind does not match', () => {
    const token = mintBridgeToken(scope, SECRET);
    const wrongKind: TokenScope = { ...scope, kind: 'build' };
    const result = verifyBridgeToken(token, wrongKind, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope_mismatch');
  });

  it('rejects an expired token', () => {
    const expired: TokenScope = { ...scope, expiresAt: Date.now() - 1 };
    const token = mintBridgeToken(expired, SECRET);
    const result = verifyBridgeToken(token, expired, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered token (signature mismatch)', () => {
    const token = mintBridgeToken(scope, SECRET);
    const tampered = token.slice(0, -4) + 'AAAA';
    const result = verifyBridgeToken(tampered, scope, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintBridgeToken(scope, SECRET);
    const result = verifyBridgeToken(token, scope, 'different-secret-also-32-bytes-long-eh');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects a token with extra separator segments', () => {
    const token = mintBridgeToken(scope, SECRET);
    const broken = token + '.junk';
    const result = verifyBridgeToken(broken, scope, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('malformed');
  });

  it('rejects a token whose kindId contains the legacy pipe separator', () => {
    const tricky: TokenScope = { ...scope, kindId: 'wf|99' };
    const token = mintBridgeToken(tricky, SECRET);
    const result = verifyBridgeToken(token, tricky, SECRET);
    // After the JSON payload migration, this MUST verify cleanly:
    expect(result.ok).toBe(true);
  });
});
