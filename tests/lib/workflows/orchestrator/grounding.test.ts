import { describe, it, expect } from 'vitest';
import { buildNodeGrounding } from '$lib/workflows/orchestrator/grounding';
import type { NodeDefinition } from '$lib/workflows/types';

const mockDef: NodeDefinition = {
  type: 'http-request',
  label: 'HTTP Request',
  category: 'core',
  description: 'Make HTTP requests to external APIs',
  configSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Request URL' },
      method: { type: 'string', description: 'HTTP method' },
    },
  },
  defaultConfig: { url: '', method: 'GET' },
  inputs: [{ name: 'input', type: 'object' }],
  outputs: [{ name: 'output', type: 'object' }],
  llmDescription: 'Use for any HTTP API call. Supports templated URLs with {{input.field}} syntax.',
  llmExamples: [{ url: 'https://api.example.com/data', method: 'GET' }],
};

const mockExecution = {
  nodeType: 'http-request',
  inputData: { url: 'https://api.strava.com/activities', headers: { Authorization: 'Bearer xxx' } },
  outputData: { status: 200, body: { activities: [{ id: 1, name: 'Morning Run' }] } },
};

describe('buildNodeGrounding', () => {
  it('includes node type, label, and description', () => {
    const result = buildNodeGrounding([mockDef], []);
    expect(result).toContain('### HTTP Request (`http-request`)');
    expect(result).toContain('Make HTTP requests to external APIs');
  });

  it('includes input/output port schemas', () => {
    const result = buildNodeGrounding([mockDef], []);
    expect(result).toContain('**Inputs:**');
    expect(result).toContain('input');
    expect(result).toContain('**Outputs:**');
    expect(result).toContain('output');
  });

  it('includes config fields with types and descriptions', () => {
    const result = buildNodeGrounding([mockDef], []);
    expect(result).toContain('url');
    expect(result).toContain('string');
    expect(result).toContain('Request URL');
  });

  it('includes llmDescription when present', () => {
    const result = buildNodeGrounding([mockDef], []);
    expect(result).toContain('Supports templated URLs');
  });

  it('includes execution examples when provided', () => {
    const result = buildNodeGrounding([mockDef], [mockExecution]);
    expect(result).toContain('**Real usage example:**');
    expect(result).toContain('strava.com');
  });

  it('omits execution examples when none match', () => {
    const otherExecution = { ...mockExecution, nodeType: 'transform' };
    const result = buildNodeGrounding([mockDef], [otherExecution]);
    expect(result).not.toContain('**Real usage example:**');
  });

  it('truncates large execution data', () => {
    const bigOutput = { data: 'x'.repeat(1000) };
    const bigExecution = { ...mockExecution, outputData: bigOutput };
    const result = buildNodeGrounding([mockDef], [bigExecution]);
    expect(result.length).toBeLessThan(result.indexOf('Real usage') + 600);
  });

  it('handles nodes with no config properties', () => {
    const triggerDef: NodeDefinition = {
      ...mockDef,
      type: 'manual-trigger',
      label: 'Manual Trigger',
      configSchema: { type: 'object' },
      inputs: [],
    };
    const result = buildNodeGrounding([triggerDef], []);
    expect(result).toContain('Manual Trigger');
  });
});
