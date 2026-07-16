import { describe, it, expect } from 'vitest';
import { buildToolUseSystemPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifySystemPrompt } from '$lib/workflows/orchestrator/prompts';
import { buildNodeGrounding } from '$lib/workflows/orchestrator/grounding';
import { getPatternsForOrchestrator, getGoldenExemplarsForOrchestrator } from '$lib/workflows/orchestrator/patterns';
import type { NodeDefinition } from '$lib/workflows/types';

function makeNodeDef(overrides: Partial<NodeDefinition> & { type: string }): NodeDefinition {
  return {
    type: overrides.type,
    label: overrides.label ?? overrides.type,
    category: overrides.category ?? 'core',
    description: overrides.description ?? `${overrides.type} node`,
    configSchema: overrides.configSchema ?? { type: 'object', properties: {} },
    defaultConfig: overrides.defaultConfig ?? {},
    inputs: overrides.inputs ?? [],
    outputs: overrides.outputs ?? [],
    llmDescription: overrides.llmDescription,
    llmExamples: overrides.llmExamples,
    basicConfig: overrides.basicConfig,
  };
}

const sampleDefs: NodeDefinition[] = [
  makeNodeDef({
    type: 'manual-trigger',
    label: 'Manual Trigger',
    category: 'trigger',
    description: 'Starts a workflow manually.',
  }),
  makeNodeDef({
    type: 'transform',
    label: 'Transform',
    description: 'Transforms input data using a JS expression.',
    configSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JS function body returning transformed output' },
      },
    },
    llmDescription: 'Use this to reshape data between nodes.',
    llmExamples: [{ expression: 'return { ...input, total: input.price * input.qty }' }],
  }),
  makeNodeDef({
    type: 'http-request',
    label: 'HTTP Request',
    description: 'Makes an HTTP request to an external API.',
    configSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP method' },
        url: { type: 'string', description: 'Target URL' },
      },
    },
  }),
];

// Build grounding from sample defs for use in prompt tests
const sampleGrounding = buildNodeGrounding(sampleDefs, []);

describe('buildToolUseSystemPrompt', () => {
  it('includes node grounding content', () => {
    const prompt = buildToolUseSystemPrompt(sampleGrounding);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('transform');
    expect(prompt).toContain('http-request');
  });

  it('includes tool-use instructions', () => {
    const prompt = buildToolUseSystemPrompt(sampleGrounding);
    expect(prompt).toContain('search_nodes');
    expect(prompt).toContain('use_node');
    expect(prompt).toContain('Finalize');
  });

  it('includes node labels and descriptions via grounding', () => {
    const prompt = buildToolUseSystemPrompt(sampleGrounding);
    expect(prompt).toContain('Manual Trigger');
    expect(prompt).toContain('Transforms input data');
  });

  it('includes composable patterns section', () => {
    const prompt = buildToolUseSystemPrompt(sampleGrounding);
    expect(prompt).toContain('Composable Patterns');
  });

  it('system prompt contains template accuracy and edge completeness rules', () => {
    const prompt = buildToolUseSystemPrompt('grounding text');
    expect(prompt).toContain('MUST match a path listed in that schema');
    expect(prompt).toContain('zero incoming edges');
  });

  // B1 — minimalism carve-out + hard rule for recurring sends.
  it('minimalism rule no longer lists data-store as a candidate to drop', () => {
    const prompt = buildToolUseSystemPrompt('grounding text');
    expect(prompt).not.toContain('transform / conditional / data-store / error-handler');
  });

  it('includes the memory carve-out (memory nodes are load-bearing, never bloat)', () => {
    const prompt = buildToolUseSystemPrompt('grounding text');
    expect(prompt).toContain('Carve-out');
    expect(prompt).toContain('load-bearing, never bloat');
    expect(prompt).toMatch(/`state` \/ `data-store` \/ `dedupe`/);
  });

  it('includes the hard rule that recurring send workflows must remember what was sent', () => {
    const prompt = buildToolUseSystemPrompt('grounding text');
    expect(prompt).toContain('recurring send workflows MUST remember what was sent');
    expect(prompt).toContain('MUST include a `dedupe` node');
    // The escape hatch: explicit repeats must be justified in the description.
    expect(prompt).toContain('state WHY in the workflow description');
  });

  // B4 — plan-phase robustness checklist for recurring workflows.
  it('includes the recurring-workflow plan checklist (run 2 / store keys / zero items)', () => {
    const prompt = buildToolUseSystemPrompt('grounding text');
    expect(prompt).toContain('Recurring-workflow plan checklist');
    expect(prompt).toContain('what stops a duplicate send');
    expect(prompt).toContain('storeKey');
    expect(prompt).toContain('yields nothing this run');
  });
});

describe('buildCriticPrompt', () => {
  it('includes review dimensions', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).toContain('error handling');
    expect(prompt).toContain('data shape');
  });

  // B2 — critic retune: stop calling data-stores bloat, add missing-dedup check.
  it('no longer names redundant data-stores as bloat', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).not.toContain('redundant data-stores');
  });

  it('carves memory nodes out of the bloat dimension (memory is never bloat)', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).toContain('Memory is never bloat');
    expect(prompt).toMatch(/Do NOT flag `data-store` \/ `dedupe` \/ `state` memory nodes as redundant/);
  });

  it('adds a MISSING-severity check for recurring send without dedup memory', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).toContain('Missing dedup memory on a recurring send');
    expect(prompt).toContain('MISSING');
    // Must name the dedupe node and where to insert it.
    expect(prompt).toContain('name the `dedupe` node');
    expect(prompt).toContain('between the source node and the summarise/send node');
  });
});

describe('patterns — Scrape-Diff-Notify de-keywording (B5)', () => {
  it('the Scrape-Diff-Notify trigger matches digest/briefing/monitor/news phrasing', () => {
    const patterns = getPatternsForOrchestrator();
    expect(patterns).toContain('Scrape-Diff-Notify');
    expect(patterns).toContain('digest');
    expect(patterns).toContain('briefing');
    expect(patterns).toContain('monitor');
    expect(patterns).toContain('news');
    // Explicitly no longer gated on the "new"/"already seen" keywords.
    expect(patterns).toContain('EVEN WHEN the request never says "new" or "already seen"');
  });

  it('the pattern now recommends a dedupe node between source and send', () => {
    const patterns = getPatternsForOrchestrator();
    expect(patterns).toContain('dedupe');
  });
});

describe('patterns — recurring digest golden exemplar (B5)', () => {
  const exemplars = getGoldenExemplarsForOrchestrator();

  it('adds a news-briefing-to-WhatsApp exemplar built on a dedupe node', () => {
    expect(exemplars).toContain('WhatsApp me a briefing');
    expect(exemplars).toContain('tavily-search');
    expect(exemplars).toContain('dedupe');
    // Real dedupe config keys from dedupe.def.ts.
    expect(exemplars).toContain('itemsPath: "results"');
    expect(exemplars).toContain('idPath: "url"');
    expect(exemplars).toContain('storeKey: "seen_news_urls"');
  });

  it('surfaces the exemplar for a digest request that never uses the literal keyword "already seen"', () => {
    // getGoldenExemplarsForOrchestrator always emits every exemplar (no keyword gating),
    // so a "daily news briefing to whatsapp" style request reaches the dedupe exemplar
    // even though its own request line never says "new" or "already seen".
    const start = exemplars.indexOf('Every morning at 7');
    expect(start).toBeGreaterThan(-1);
    const rest = exemplars.slice(start);
    const nextHeader = rest.indexOf('### Example', 1);
    const briefingBlock = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
    // This exemplar's own request/config/note never leans on the gated keywords.
    expect(briefingBlock).not.toContain('already seen');
    expect(briefingBlock).toContain('dedupe');
    // The zero-new-items guard is demonstrated.
    expect(exemplars).toContain('input.newCount > 0');
    expect(exemplars).toContain('{{today}}');
  });
});

describe('buildRevisionPrompt', () => {
  it('includes instruction to address feedback', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt).toContain('address');
    expect(prompt).toContain('critic');
  });
});

describe('buildModifySystemPrompt', () => {
  it('includes current workflow context', () => {
    const currentWorkflow = {
      nodes: [{ id: 'n1', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' }],
      edges: [],
    };
    const prompt = buildModifySystemPrompt(currentWorkflow, sampleGrounding);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('Current Workflow');
  });
});
