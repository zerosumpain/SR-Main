import { describe, it, expect } from 'vitest';
import {
  signBridgeToken,
  verifyBridgeToken,
  invokeTool,
} from '$lib/jkai/tool-bridge';

describe('bridge tokens', () => {
  it('round-trips a build id through sign/verify', () => {
    const tok = signBridgeToken('build-xyz');
    expect(verifyBridgeToken(tok)).toBe('build-xyz');
  });

  it('rejects a tampered token', () => {
    expect(verifyBridgeToken('bogus')).toBeNull();
    expect(verifyBridgeToken('')).toBeNull();
  });

  it('rejects a token signed with a different secret-derived sig', () => {
    const tok = signBridgeToken('build-xyz');
    const decoded = Buffer.from(tok, 'base64url').toString('utf-8');
    // tamper the signature byte
    const parts = decoded.split('.');
    parts[2] = parts[2].replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    const tampered = Buffer.from(parts.join('.')).toString('base64url');
    expect(verifyBridgeToken(tampered)).toBeNull();
  });
});

describe('invokeTool', () => {
  it('throws for an unknown tool name', async () => {
    await expect(invokeTool('definitely_not_a_real_tool_xyz', {})).rejects.toThrow(/unknown tool/i);
  });
});
