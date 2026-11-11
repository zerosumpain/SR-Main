import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, CAPABILITIES_VERSION, capabilitiesFor, capabilityForToolset, rankCapabilities, toolsetBlurb } from './manifest';
import { manifestDrift, type RegistryTool } from './drift';
import { CUSTOM_TOOLSET_PREFIX } from './types';
import { MEMBER_SAFE_TOOLS, tierOf } from '$lib/tools/invoke-contract';

// The drift guards (plan point 7, slice 7b). The manifest is a tool-free leaf;
// this test is the one place that loads the registry beside it, so CI goes red
// when the two disagree. Only the TEST imports the registry.

async function registrySnapshot(): Promise<RegistryTool[]> {
  const reg = await import('$lib/tools/registry');
  // The domains that register their chat tools from hooks.server.ts, read off
  // that file so a new one cannot be wired there and forgotten here.
  for (const path of hookChatToolModules()) await import(/* @vite-ignore */ path);
  return reg.getTools().map((t) => ({ name: t.name, toolset: t.toolset, ...tierOf(t) }));
}

/** Every `$lib/…/chat-tools` side-effect import in hooks.server.ts, as a file URL. */
export function hookChatToolModules(source = readFileSync(HOOKS, 'utf8')): string[] {
  return [...source.matchAll(/^import\s+['"]\$lib\/([\w/-]+\/chat-tools)['"];?\s*$/gm)].map((m) => new URL(`../${m[1]}.ts`, import.meta.url).href);
}

const HOOKS = fileURLToPath(new URL('../../hooks.server.ts', import.meta.url));
const GENERATED = fileURLToPath(new URL('./capabilities.generated.json', import.meta.url));

describe('capability manifest drift guards', () => {
  it('agrees with the registry', async () => {
    const registry = await registrySnapshot();
    expect(manifestDrift(CAPABILITIES, registry, MEMBER_SAFE_TOOLS)).toEqual([]);
  }, 120_000);

  it('gives every registered toolset a description from its row', async () => {
    const reg = await import('$lib/tools/registry');
    await registrySnapshot();
    for (const m of reg.getToolsetManifest()) {
      expect(m.description, m.toolset).not.toBe(m.toolset);
      expect(toolsetBlurb(m.toolset)).toBe(m.description);
    }
  }, 120_000);

  it('bites: a renamed tool, a toolset with no row, a shipped planned tool, a wide member row', async () => {
    const registry = await registrySnapshot();
    const renamed = registry.map((t) => (t.name === 'trip_get' ? { ...t, name: 'trip_read' } : t));
    expect(manifestDrift(CAPABILITIES, renamed, MEMBER_SAFE_TOOLS)).toEqual(
      expect.arrayContaining(['trips: names trip_get, which is not registered', 'trips: registered tool trip_read is not named in its row']),
    );
    const extra = [...registry, { name: 'brand_new', toolset: 'brand-new', effect: 'read', confirm: 'never' }];
    expect(manifestDrift(CAPABILITIES, extra, MEMBER_SAFE_TOOLS)).toContain('toolset brand-new (brand_new) has no capability row');
    const shipped = [...registry, { name: 'family_digest', toolset: 'family', effect: 'read', confirm: 'never' }];
    expect(manifestDrift(CAPABILITIES, shipped, MEMBER_SAFE_TOOLS).some((p) => p.includes('planned, but family_digest is registered'))).toBe(true);
    const wide = CAPABILITIES.map((c) => (c.id === 'trips' ? { ...c, memberSafe: true } : c));
    expect(manifestDrift(wide, registry, MEMBER_SAFE_TOOLS).some((p) => p.startsWith('trips: member-safe, but'))).toBe(true);
    const dated = CAPABILITIES.map((c) => (c.id === 'news' ? { ...c, blurb: 'News, currently from 2 sources' } : c));
    expect(manifestDrift(dated, registry, MEMBER_SAFE_TOOLS).some((p) => p.startsWith('news: blurb'))).toBe(true);
  }, 120_000);

  it('reads the chat-tool modules off hooks.server.ts', () => {
    const found = hookChatToolModules().map((u) => u.replace(/^.*\/src\/lib\//, ''));
    expect(found).toEqual(expect.arrayContaining(['daydream/chat-tools.ts', 'owner-data/chat-tools.ts', 'trips/chat-tools.ts', 'captures/chat-tools.ts', 'family/chat-tools.ts', 'home/presence/chat-tools.ts']));
    for (const u of hookChatToolModules()) expect(() => readFileSync(fileURLToPath(u)), u).not.toThrow();
    expect(hookChatToolModules("import '$lib/a-b/chat-tools';\n// import '$lib/x/chat-tools';\nimport { y } from '$lib/y/chat-tools';")).toHaveLength(1);
  });

  it('keeps the custom prefix reserved and maps it to the custom row', () => {
    for (const row of CAPABILITIES) for (const ts of row.toolsets) expect(ts.startsWith(CUSTOM_TOOLSET_PREFIX)).toBe(false);
    expect(capabilityForToolset('custom:sports')?.id).toBe('custom');
    expect(capabilityForToolset('custom:sports')?.status).toBe('preview');
  });

  it('seeds the planned gaps the audit found', () => {
    const planned = CAPABILITIES.filter((c) => c.status === 'planned').map((c) => c.id);
    expect(planned).toEqual(expect.arrayContaining(['family-photos', 'people-location', 'wildmind']));
  });

  it('tells a member only of live, member-safe rows', () => {
    const member = capabilitiesFor('u_member1');
    expect(member.length).toBeGreaterThan(0);
    expect(member.every((c) => c.memberSafe && c.status === 'live')).toBe(true);
    expect(capabilitiesFor('owner').length).toBe(CAPABILITIES.length);
  });

  it('ranks a planned ask to its row and a live ask above a planned one', () => {
    expect(rankCapabilities('can you show me the family photos')[0]?.entry.id).toBe('family-photos');
    expect(rankCapabilities('is the family alarm raised')[0]?.entry.id).toBe('family');
    expect(rankCapabilities('where is my son right now')[0]?.entry).toMatchObject({ id: 'people-location', status: 'planned' });
    expect(rankCapabilities('what is on my trip on day 2')[0]?.entry.id).toBe('trips');
    expect(rankCapabilities('hometowns leaderboard')[0]?.entry.id).toBe('hometowns');
    expect(rankCapabilities('')).toEqual([]);
  });

  // Read by SR-Infra (and copied into Core's fixture) without building Main.
  // Regenerate with UPDATE_CAPABILITIES=1 npx vitest run src/lib/capabilities/manifest.test.ts
  it('matches capabilities.generated.json', () => {
    const doc = { version: CAPABILITIES_VERSION, capabilities: CAPABILITIES };
    const text = JSON.stringify(doc, null, 2) + '\n';
    if (process.env.UPDATE_CAPABILITIES === '1') writeFileSync(GENERATED, text);
    expect(readFileSync(GENERATED, 'utf8')).toBe(text);
  });
});
