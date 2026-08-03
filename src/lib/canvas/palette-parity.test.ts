import { describe, it, expect } from 'vitest';
import { byType } from './adapter';
import { nodeDefinitions, getDefinition } from '$lib/workflows/registry-client';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';

// `switch` is intentionally excluded from the palette until the canvas renders
// its per-config (switchHandles) output ports — mirror adapter.ts's skip set.
const DYNAMIC_HANDLE_SKIP = new Set(['switch']);

describe('canvas palette ↔ registry parity', () => {
  it('every registered, user-addable node has a palette entry (no silent drift)', () => {
    const missing = nodeDefinitions
      .filter((d) => !d.hidden && !isDisplayOnlyType(d.type) && !DYNAMIC_HANDLE_SKIP.has(d.type))
      .map((d) => d.type)
      .filter((t) => !byType(t));
    expect(missing).toEqual([]);
  });

  // Neither this file nor registry-parity compared CONFIG — they check the set
  // of node types and the palette's handles — so a key added to a definition
  // but not to the palette's defaultConfig (or the reverse) drifts silently,
  // and verify.ts then rejects a freshly-dropped node's own default as an
  // unknown config key. Scoped to the API nodes: a fleet-wide version of this
  // assertion currently fails on ~25 pre-existing mismatches, which are their
  // own piece of work.
  it('the API nodes agree between palette defaultConfig and configSchema', () => {
    for (const type of ['api-call', 'api-integration']) {
      const def = nodeDefinitions.find((d) => d.type === type);
      const entry = byType(type);
      expect(def, `no definition for ${type}`).toBeTruthy();
      expect(entry?.defaultConfig, `no palette defaultConfig for ${type}`).toBeTruthy();
      const schemaKeys = Object.keys(def!.configSchema?.properties ?? {}).sort();
      const paletteKeys = Object.keys(entry!.defaultConfig!).sort();
      expect(paletteKeys, `${type} palette defaultConfig drifted from its configSchema`).toEqual(schemaKeys);
    }
  });

  it('previously-unreachable nodes are now in the palette and wireable', () => {
    for (const t of ['apple-calendar', 'approval']) {
      const entry = byType(t);
      expect(entry, `missing palette entry for ${t}`).toBeTruthy();
      // A node with no handles cannot be wired on the canvas.
      expect(entry!.handles.inputs.length + entry!.handles.outputs.length).toBeGreaterThan(0);
    }
  });

  // E4: the RAG + research capability nodes must sit together in one coherent
  // "Intelligence" group so the builder can find them, with a positive default
  // weight so they surface in ranked suggestions rather than sinking to zero.
  it('groups the intelligence/RAG nodes under "Intelligence" with a sensible weight', () => {
    for (const t of ['file-search', 'research-search', 'deep-research', 'research-result']) {
      const entry = byType(t);
      expect(entry, `missing palette entry for ${t}`).toBeTruthy();
      expect(entry!.group, `${t} should be in the Intelligence group`).toBe('Intelligence');
      expect(entry!.defaultWeight ?? 0, `${t} should have a positive default weight`).toBeGreaterThan(0);
    }
  });

  // The curated palette entries used to re-type their node's defaultConfig by
  // hand and drifted from it: an LLM call was born at 1024 tokens against a def
  // that said 2048, and an LLM router was born with a `prompt` key its executor
  // never reads and no `routes` at all — so it failed on its first run. The
  // adapter now merges each definition's defaults under the curated ones; this
  // is what stops that drifting again.
  it('drops a node onto the canvas with every default its definition declares', () => {
    const drift: string[] = [];
    for (const def of nodeDefinitions) {
      const entry = byType(def.type);
      if (!entry) continue;
      for (const key of Object.keys(def.defaultConfig ?? {})) {
        if (!(key in entry.defaultConfig)) drift.push(`${def.type}.${key}`);
      }
    }
    expect(drift).toEqual([]);
  });

  // John, 2026-08-02: "Canvas nodes using LLM should be built defaulting to the
  // site default selected in the LLM modal in jkai. token limit should be
  // 25000." An empty model is what tracks the picker — resolveLLMClient turns
  // it into the site default at run time, so the node follows the modal instead
  // of freezing on whatever was default the day it was created.
  it('builds every LLM node on the site default model with a 25000-token ceiling', () => {
    for (const type of ['llm-call', 'llm-agent', 'think', 'openrouter']) {
      const def = getDefinition(type)!;
      expect(def.defaultConfig.model, `${type} def model`).toBe('');
      expect(def.defaultConfig.maxTokens, `${type} def maxTokens`).toBe(DEFAULT_NODE_MAX_TOKENS);
      const entry = byType(type)!;
      expect(entry.defaultConfig.model, `${type} palette model`).toBe('');
      expect(entry.defaultConfig.maxTokens, `${type} palette maxTokens`).toBe(DEFAULT_NODE_MAX_TOKENS);
    }
    // The router only ever emits a single route handle, so it carries no token
    // budget of its own — but it must still be born on the site default, and
    // with the routes its executor actually reads.
    const router = byType('llm-router')!;
    expect(router.defaultConfig.model).toBe('');
    expect(router.defaultConfig.routes).toBeTruthy();
    expect(router.defaultConfig).not.toHaveProperty('prompt');
  });

  it('exposes the webpage node for the research desk palette (E4 parity)', () => {
    const entry = byType('webpage');
    expect(entry).toBeTruthy();
    // The desk renders the same webpage kind; it must not be marked deskOnly
    // (which would hide it from the workflow canvas), and it must be wireable.
    expect(entry!.kind).toBe('webpage');
    expect(entry!.handles.inputs.length + entry!.handles.outputs.length).toBeGreaterThan(0);
  });
});
