import { describe, it, expect } from 'vitest';
import { buildPlannerPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifyPrompt } from '$lib/workflows/orchestrator/prompts';
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

describe('buildPlannerPrompt', () => {
  it('includes available node types', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('transform');
    expect(prompt).toContain('http-request');
  });

  it('includes JSON output instruction', () => {
    const prompt = buildPlannerPrompt([sampleDefs[0]]);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('nodes');
    expect(prompt).toContain('edges');
  });

  it('includes node labels and descriptions', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Manual Trigger');
    expect(prompt).toContain('Transforms input data');
  });

  it('includes llmDescription as Guidance when present', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Guidance:');
    expect(prompt).toContain('Use this to reshape data between nodes.');
  });

  it('includes first llmExample when present', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Example config:');
    expect(prompt).toContain('expression');
  });

  it('includes config field details from configSchema', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Config fields:');
    expect(prompt).toContain('expression');
    expect(prompt).toContain('JS function body returning transformed output');
  });

  it('includes composable patterns section', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Composable Patterns');
  });

  it('includes agentic workflow design tips', () => {
    const prompt = buildPlannerPrompt(sampleDefs);
    expect(prompt).toContain('Agentic Workflow Design Tips');
    expect(prompt).toContain('Iterative refinement');
    expect(prompt).toContain('Text Parser');
    expect(prompt).toContain('Validator');
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

describe('buildModifyPrompt', () => {
  it('includes current workflow context', () => {
    const currentWorkflow = {
      nodes: [{ id: 'n1', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' }],
      edges: [],
    };
    const prompt = buildModifyPrompt(currentWorkflow, sampleDefs);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('current workflow');
  });
});
