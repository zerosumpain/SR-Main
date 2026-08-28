import { describe, it, expect } from 'vitest';
import { handleJkaiHelp } from './meta-tools';
import { getToolsetManifest } from './registry';

/**
 * `jkai_help()` is the model's own recovery route: the call it makes when it
 * knows a capability should exist but has no tool for it. That route was
 * structurally broken — the unfiltered reply carried every tool's full
 * description at ~58KB against the chat loop's 32KB tool-result clip, so
 * roughly the last 45% of the catalogue was cut off silently.
 *
 * On 2026-08-13 that lost `decks`: the model asked what was available, could
 * not see the deck builder, told John the site had no native deck creator, and
 * offered Google Slides instead — a tool that does not exist anywhere.
 */
const LOOP_RESULT_CLIP = 32000; // general-chat.ts truncates tool results here

describe('handleJkaiHelp', () => {
  it('fits the unfiltered catalogue inside the loop result clip', () => {
    const bytes = JSON.stringify(handleJkaiHelp({})).length;
    expect(bytes).toBeLessThan(LOOP_RESULT_CLIP);
  });

  it('lists every toolset, decks included', () => {
    const data = handleJkaiHelp({}).data as { toolsets: Array<{ toolset: string }> };
    const listed = data.toolsets.map((t) => t.toolset);
    expect(listed).toEqual(getToolsetManifest().map((m) => m.toolset));
    expect(listed).toContain('decks');
  });

  // The specific tool the failed turn was looking for, reachable without a
  // second round-trip: names are in the index, so one filtered call is enough.
  it('names the deck builder in the index', () => {
    const raw = JSON.stringify(handleJkaiHelp({}));
    expect(raw.slice(0, LOOP_RESULT_CLIP)).toContain('presentation_build_from_spec');
  });

  it('still returns full descriptions for a named toolset', () => {
    const res = handleJkaiHelp({ toolset: 'decks' });
    const entry = res.data as { tools: Array<{ name: string; description: string }> };
    expect(res.success).toBe(true);
    const build = entry.tools.find((t) => t.name === 'presentation_build_from_spec');
    expect(build?.description.length).toBeGreaterThan(100);
  });

  it('reports an unknown toolset rather than guessing', () => {
    const res = handleJkaiHelp({ toolset: 'google-slides' });
    expect(res.success).toBe(false);
  });
});
