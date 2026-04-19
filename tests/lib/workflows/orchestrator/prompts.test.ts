import { describe, it, expect } from 'vitest';
import { buildToolUseSystemPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifySystemPrompt } from '$lib/workflows/orchestrator/prompts';
import { buildNodeGrounding } from '$lib/workflows/orchestrator/grounding';
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
});

describe('buildCriticPrompt', () => {
  it('includes review dimensions', () => {
    const prompt = buildCriticPrompt();
    expect(prompt).toContain('error handling');
    expect(prompt).toContain('data shape');
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
