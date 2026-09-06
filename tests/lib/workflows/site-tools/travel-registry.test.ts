import { describe, it, expect } from 'vitest';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';

// The unit tests next to travel.ts import the module directly, which proves it
// registers but not that `registry.ts` ever loads it. A tool nothing imports
// looks exactly like one that does not exist — so this asserts the real
// manifest, assembled the way the chat assembles it.
describe('travel toolset', () => {
  it('appears in the manifest with its three tools', () => {
    const t = getToolsetManifest().find((x) => x.toolset === 'travel');
    expect(t).toBeDefined();
    expect(t!.tools.map((x) => x.name).sort()).toEqual([
      'reachable_area',
      'route_directions',
      'travel_time_matrix',
    ]);
  });

  it('carries a real description, not the fallback of its own name', () => {
    // `getToolsetManifest` falls back to the bare toolset key when no
    // description is registered, so "travel" would pass a naive presence check
    // while telling the model nothing about what is in it.
    const t = getToolsetManifest().find((x) => x.toolset === 'travel');
    expect(t!.description).not.toBe('travel');
    expect(t!.description).toMatch(/route|direction|travel time/i);
    // It should also say which tool answers the sport question instead.
    expect(t!.description).toMatch(/route_plan/);
  });

  it('leaves the sport planner where it was', () => {
    const health = getToolsetManifest().find((x) => x.toolset === 'health');
    expect(health!.tools.map((x) => x.name)).toContain('route_plan');
  });
});
