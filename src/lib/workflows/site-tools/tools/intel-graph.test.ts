// Registration + contract tests for the intel-graph toolset.
//
// The handlers themselves are thin wrappers over the analytics layer, which has
// its own 57 unit tests. What is worth guarding here is the wiring: that every
// tool is actually registered under the expected name, carries a schema the LLM
// can call, and declares the toolset that gates it — the class of mistake that
// produced a `DEFAULT_SUBAGENT_TOOLS` entry naming a tool that never existed.
import { describe, it, expect } from 'vitest';
import { getTool, getTools } from '../registry';
import { DEFAULT_SUBAGENT_TOOLS } from '$lib/workflows/chat/sub-agent';

const TOOLS = [
  'intel_find',
  'intel_neighbourhood',
  'intel_path',
  'intel_insights',
  'intel_unlikely_relations',
];

describe('intel-graph toolset', () => {
  it('registers every tool', () => {
    for (const name of TOOLS) {
      expect(getTool(name), `${name} is not registered`).toBeDefined();
    }
  });

  it('files them all under the intel-graph toolset', () => {
    for (const name of TOOLS) {
      expect(getTool(name)?.toolset).toBe('intel-graph');
    }
  });

  it('gives each an object schema the model can call', () => {
    for (const name of TOOLS) {
      const tool = getTool(name)!;
      expect(tool.parameters?.type).toBe('object');
      expect(tool.parameters?.properties).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('marks the entity-taking tools as requiring their argument', () => {
    expect(getTool('intel_find')?.parameters?.required).toContain('query');
    expect(getTool('intel_neighbourhood')?.parameters?.required).toContain('entity');
    expect(getTool('intel_path')?.parameters?.required).toEqual(
      expect.arrayContaining(['from', 'to']),
    );
  });

  it('leaves the survey tools callable with no arguments', () => {
    // A standing "what's interesting" question should not need parameters.
    expect(getTool('intel_insights')?.parameters?.required ?? []).toEqual([]);
    expect(getTool('intel_unlikely_relations')?.parameters?.required ?? []).toEqual([]);
  });

  it('declares none of them destructive — the whole toolset is read-only', () => {
    for (const name of TOOLS) {
      expect(getTool(name)?.destructive ?? false).toBe(false);
    }
  });

  it('rejects a call with a missing required argument rather than throwing', async () => {
    const result = await getTool('intel_find')!.handler({}, {} as never);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/required/i);
  });
});

// Runtime smoke tests. Registration tests prove the wiring; these prove the
// handlers actually execute against a real (possibly empty) graph without
// throwing — the failure mode registration tests cannot see. An empty graph is
// the honest CI case and also the hardest one for the analytics to survive.
describe('intel-graph handlers against a live graph', () => {
  /** Tool results are typed loosely at the registry boundary; narrow for assertions. */
  const data = (r: { data?: unknown }): Record<string, any> => (r.data ?? {}) as Record<string, any>;

  it('intel_find returns a well-formed result for a query that matches nothing', async () => {
    const r = await getTool('intel_find')!.handler({ query: 'zzz-no-such-entity-zzz' }, {} as never);
    expect(r.success).toBe(true);
    expect(data(r).count).toBe(0);
    expect(Array.isArray(data(r).entities)).toBe(true);
  }, 30_000);

  it('intel_neighbourhood reports a clean miss rather than throwing', async () => {
    const r = await getTool('intel_neighbourhood')!.handler(
      { entity: 'zzz-no-such-entity-zzz' },
      {} as never,
    );
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/no entity/i);
  }, 30_000);

  it('intel_path reports a clean miss for unknown endpoints', async () => {
    const r = await getTool('intel_path')!.handler(
      { from: 'zzz-nope-a', to: 'zzz-nope-b' },
      {} as never,
    );
    expect(r.success).toBe(false);
  }, 30_000);

  it('intel_insights runs and reports graph totals', async () => {
    const r = await getTool('intel_insights')!.handler({}, {} as never);
    expect(r.success).toBe(true);
    expect(typeof data(r).graph?.entities).toBe('number');
    expect(Array.isArray(data(r).insights)).toBe(true);
  }, 30_000);

  it('intel_unlikely_relations runs and returns an array', async () => {
    const r = await getTool('intel_unlikely_relations')!.handler({ limit: 3 }, {} as never);
    expect(r.success).toBe(true);
    expect(Array.isArray(data(r).relations)).toBe(true);
  }, 30_000);
});

describe('DEFAULT_SUBAGENT_TOOLS', () => {
  // Tools a sub-agent gets from the Hermes MCP session rather than this
  // registry. They cannot be checked here, so they are named explicitly — which
  // is the point: anything NOT on this list must resolve locally, and
  // `intel_search` resolved in neither place.
  const EXTERNAL = new Set(['web_search', 'webpage_fetch']);

  it('names only tools that exist locally or are known externals', () => {
    const known = new Set(getTools().map((t) => t.name));
    for (const name of DEFAULT_SUBAGENT_TOOLS) {
      expect(
        known.has(name) || EXTERNAL.has(name),
        `${name} is in DEFAULT_SUBAGENT_TOOLS but is neither registered nor a known external tool`,
      ).toBe(true);
    }
  });

  it('no longer references the tool that never existed', () => {
    expect(DEFAULT_SUBAGENT_TOOLS).not.toContain('intel_search');
  });

  it('gives a sub-agent a way to reach the knowledge base and the graph', () => {
    expect(DEFAULT_SUBAGENT_TOOLS).toContain('knowledge_search');
    expect(DEFAULT_SUBAGENT_TOOLS.some((t) => t.startsWith('intel_'))).toBe(true);
  });
});
