import { describe, it, expect, beforeAll } from 'vitest';

// The bridge signs with JKAI_BRIDGE_SECRET at call time, so it must exist
// before anything imports through to `secret()`.
process.env.JKAI_BRIDGE_SECRET = 'bridge-test-secret-at-least-32-characters-long';

import { signBridgeToken, verifyBridgeToken } from './bridge-token';
import {
  isBridgeable,
  definitionsForBuild,
  manifestForBuild,
  invokeTool,
  BRIDGE_MUTATES,
  buildWriteRefusal,
} from './tool-bridge';
import { getTool } from '$lib/tools/registry';
import { declaredTier } from '$lib/tools/declared-tier';

beforeAll(async () => {
  // Populate the registry — the toolset helpers read from it — including the
  // domains hooks.server.ts registers in production.
  await import('$lib/tools/registry');
  await import('$lib/daydream/chat-tools');
  await import('$lib/owner-data/chat-tools');
  await import('$lib/trips/chat-tools');
  await import('$lib/captures/chat-tools');
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
  it('classifies destructive tools as un-bridgeable', async () => {
    if (getTool('publish_page')) expect(await isBridgeable('publish_page')).toBe(false);
    if (getTool('gmail_send')) expect(await isBridgeable('gmail_send')).toBe(false);
  });

  it('allows read-only tools', async () => {
    if (getTool('workflow_list')) expect(await isBridgeable('workflow_list')).toBe(true);
  });

  it('omits them from the manifest and the definitions', async () => {
    const names = (await definitionsForBuild(['all'])).map((d) => d.function.name);
    for (const n of names) expect(getTool(n)?.destructive).not.toBe(true);

    const manifestNames = (await manifestForBuild(['all'])).flatMap((t) =>
      t.tools.map((x) => x.name),
    );
    for (const n of manifestNames) expect(getTool(n)?.destructive).not.toBe(true);
  });

  it('an empty toolset list grants no tools, not every tool', async () => {
    // The filter used to fail OPEN: a list that matched no toolset fell through
    // to the full definition set, so "allow nothing" and "allow everything"
    // were the same request. The Controls panel can now write this list, so the
    // difference is reachable from the UI.
    expect(await definitionsForBuild([])).toHaveLength(0);
  });

  it('an unrecognised toolset name grants no tools either', async () => {
    expect(await definitionsForBuild(['nope-not-a-toolset'])).toHaveLength(0);
  });

  it('a named toolset grants only its own tools', async () => {
    const withBuilds = (await definitionsForBuild(['builds'])).map((d) => d.function.name);
    const everything = (await definitionsForBuild(['all'])).map((d) => d.function.name);
    expect(withBuilds.length).toBeGreaterThan(0);
    expect(withBuilds.length).toBeLessThan(everything.length);
    const allowed = new Set(
      (await manifestForBuild(['builds'])).flatMap((t) => t.tools.map((x) => x.name)),
    );
    for (const n of withBuilds) expect(allowed.has(n)).toBe(true);
  });

  it('refuses to invoke one even if the agent guesses the name', async () => {
    if (!getTool('publish_page')) return;
    await expect(invokeTool('publish_page', { slug: 'x', content: 'y' })).rejects.toThrow(
      /destructive tool and is not available to builds/,
    );
  });
});

describe('the bridge offers reads and only the reviewed build mutates', () => {
  // An unattended 'bridge' principal: a build's toolsets ('all' by default)
  // used to put every non-destructive mutate on its list, forget_memory and
  // notify_owner included.
  it('pins the mutate list', () => {
    expect([...BRIDGE_MUTATES]).toEqual(['build_write_file']);
  });

  it('offers no other tool that changes anything, whatever the toolsets', async () => {
    for (const sets of [['all'], ['memory', 'whatsapp', 'home', 'schedule', 'builds']]) {
      const names = (await definitionsForBuild(sets)).map((d) => d.function.name);
      const changers = names.filter((n) => {
        const tier = declaredTier(getTool(n)!);
        return tier.effect !== 'read' || tier.confirm !== 'never';
      });
      for (const n of changers) expect(BRIDGE_MUTATES as readonly string[], n).toContain(n);
    }
    expect((await definitionsForBuild(['builds'])).map((d) => d.function.name)).toContain('build_write_file');
  });

  it.each([
    'forget_memory', 'save_memory', 'notify_owner', 'gmail_modify_labels', 'ha_call_service',
    'update_credential', 'request_credential', 'followup_schedule', 'schedule_tool_call_at',
    'register_heartbeat_action', 'datastore_save', 'register_chat_build', 'build_create', 'workflow_run',
  ])('refuses %s to the bridge', async (name) => {
    expect(getTool(name), name).toBeDefined();
    expect(await isBridgeable(name)).toBe(false);
    const manifestNames = (await manifestForBuild(['all'])).flatMap((t) => t.tools.map((x) => x.name));
    expect(manifestNames).not.toContain(name);
    await expect(invokeTool(name, {}, [name], { buildId: 'build-abc' })).rejects.toThrow(/not available to builds/);
  });

  it('holds build_write_file to the calling build and its dev space', async () => {
    expect(buildWriteRefusal({ buildId: 'build-abc', path: 'a', content: 'b' }, 'build-abc')).toBeNull();
    expect(buildWriteRefusal({ buildId: 'build-abc', space: 'dev' }, 'build-abc')).toBeNull();
    expect(buildWriteRefusal({ buildId: 'build-other' }, 'build-abc')).toMatch(/own workspace/);
    expect(buildWriteRefusal({ buildId: 'build-abc' }, undefined)).toMatch(/own workspace/);
    expect(buildWriteRefusal({ buildId: 'build-abc', space: 'live' }, 'build-abc')).toMatch(/dev space/);
    await expect(
      invokeTool('build_write_file', { buildId: 'build-other', path: 'x', content: 'y' }, ['build_write_file'], { buildId: 'build-abc' }),
    ).rejects.toThrow(/own workspace/);
  });
});
