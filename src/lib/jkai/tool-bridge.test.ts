import { describe, it, expect, beforeAll } from 'vitest';

// The bridge signs with JKAI_BRIDGE_SECRET at call time, so it must exist
// before anything imports through to `secret()`.
process.env.JKAI_BRIDGE_SECRET = 'bridge-test-secret-at-least-32-characters-long';

import {
  signBridgeToken,
  verifyBridgeToken,
  isBridgeable,
  definitionsForBuild,
  manifestForBuild,
  invokeTool,
} from './tool-bridge';
import { getTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  // Populate the registry — the toolset helpers read from it.
  await import('$lib/workflows/site-tools/registry');
});

describe('bridge tokens', () => {
  it('round-trips a build id', () => {
    const token = signBridgeToken('build-abc');
    expect(verifyBridgeToken(token)).toBe('build-abc');
  });

  it('rejects a tampered token', () => {
    const token = signBridgeToken('build-abc');
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [id, ts] = decoded.split('.');
    const forged = Buffer.from(`${id}.${ts}.${'0'.repeat(64)}`).toString('base64url');
    expect(verifyBridgeToken(forged)).toBeNull();
  });

  it('rejects rubbish', () => {
    expect(verifyBridgeToken('not-a-token')).toBeNull();
    expect(verifyBridgeToken('')).toBeNull();
  });
});

describe('destructive tools are not on the bridge', () => {
  // A build is headless: the confirmation gate that guards these everywhere
  // else has nobody to ask, so the bridge must not offer them at all.
  it('classifies destructive tools as un-bridgeable', () => {
    if (getTool('publish_page')) expect(isBridgeable('publish_page')).toBe(false);
    if (getTool('gmail_send')) expect(isBridgeable('gmail_send')).toBe(false);
  });

  it('allows read-only tools', () => {
    if (getTool('workflow_list')) expect(isBridgeable('workflow_list')).toBe(true);
  });

  it('omits them from the manifest and the definitions', () => {
    const names = definitionsForBuild(['all']).map((d) => d.function.name);
    for (const n of names) expect(getTool(n)?.destructive).not.toBe(true);

    const manifestNames = manifestForBuild(['all']).flatMap((t) => t.tools.map((x) => x.name));
    for (const n of manifestNames) expect(getTool(n)?.destructive).not.toBe(true);
  });

  it('refuses to invoke one even if the agent guesses the name', async () => {
    if (!getTool('publish_page')) return;
    await expect(invokeTool('publish_page', { slug: 'x', content: 'y' })).rejects.toThrow(
      /destructive tool and is not available to builds/,
    );
  });
});
