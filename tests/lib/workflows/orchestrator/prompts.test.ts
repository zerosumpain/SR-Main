import { describe, it, expect } from 'vitest';
import { buildPlannerPrompt, buildCriticPrompt, buildRevisionPrompt, buildModifyPrompt } from '$lib/workflows/orchestrator/prompts';

describe('buildPlannerPrompt', () => {
  it('includes available node types', () => {
    const nodeTypes = ['manual-trigger', 'transform', 'code-execute', 'http-request'];
    const prompt = buildPlannerPrompt(nodeTypes);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('transform');
    expect(prompt).toContain('http-request');
  });

  it('includes JSON output instruction', () => {
    const prompt = buildPlannerPrompt(['manual-trigger']);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('nodes');
    expect(prompt).toContain('edges');
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
    const prompt = buildModifyPrompt(currentWorkflow, ['manual-trigger', 'transform']);
    expect(prompt).toContain('manual-trigger');
    expect(prompt).toContain('current workflow');
  });
});
