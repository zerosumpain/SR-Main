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
  BRIDGE_READS,
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

  it('allows the reviewed build and catalogue reads', async () => {
    for (const n of ['build_read_file', 'codegraph_query', 'skill_view', 'tool_search', 'workflow_list_node_types']) {
      expect(await isBridgeable(n), n).toBe(true);
    }
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

describe('the bridge reads are a closed list', () => {
  const PRIVATE = [
    'gmail_search', 'gmail_get_message', 'mail_search', 'mail_read', 'recall_memories', 'memory_search', 'session_search',
    'knowledge_search', 'health_stats', 'health_sleep', 'intel_find', 'activity_search', 'apple_calendar_list',
    'file_read', 'datastore_query', 'api_secrets_list', 'browser_snapshot', 'workflow_list', 'workflow_get_run', 'fetch_url',
  ];

  it.each(PRIVATE)('never offers %s, even to an "all" build', async (name) => {
    expect(getTool(name), name).toBeDefined();
    expect(await isBridgeable(name)).toBe(false);
    const offered = (await definitionsForBuild(['all'])).map((d) => d.function.name);
    expect(offered).not.toContain(name);
    await expect(invokeTool(name, {}, [name], { buildId: 'build-abc' })).rejects.toThrow(/not available to builds|not given/);
  });

  it('never offers the chat-registered private reads (trips, captures, daydream, owner data)', async () => {
    await import('$lib/daydream/chat-tools');
    await import('$lib/owner-data/chat-tools');
    await import('$lib/trips/chat-tools');
    await import('$lib/captures/chat-tools');
    const offered = new Set((await definitionsForBuild(['all'])).map((d) => d.function.name));
    for (const n of offered) expect([...BRIDGE_READS, ...BRIDGE_MUTATES] as readonly string[], n).toContain(n);
  });

  it('offers web search only to a build that names research, and never a fetch', async () => {
    const all = (await definitionsForBuild(['all'])).map((d) => d.function.name);
    expect(all).not.toContain('research_web_search');
    const research = (await definitionsForBuild(['research', 'builds'])).map((d) => d.function.name);
    expect(research).toContain('research_web_search');
    expect(research).not.toContain('fetch_url');
    expect(research).not.toContain('research_get_report');
    expect((await definitionsForBuild(['web'])).map((d) => d.function.name)).not.toContain('fetch_url');
  });
});
