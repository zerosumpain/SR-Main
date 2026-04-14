import { describe, it, expect } from 'vitest';
import { buildHealingPrompt, parseHealingResponse } from '$lib/workflows/orchestrator/healing';
import type { HealingContext } from '$lib/workflows/types';

const mockContext: HealingContext = {
  error: 'connect ECONNREFUSED 127.0.0.1:587',
  nodeType: 'email',
  nodeLabel: 'Send Alert Email',
  nodeConfig: { to: 'john@example.com', subject: 'Alert', body: 'Test' },
  inputData: { message: 'hello' },
  nodeDefinition: {
    type: 'email',
    label: 'Email',
    category: 'integration',
    description: 'Send email via SMTP',
    configSchema: { type: 'object' },
    defaultConfig: {},
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [{ name: 'output', type: 'object' }],
  },
  previousAttempts: [],
  workflowContext: {
    nodes: [
      { id: 'n1', type: 'manual-trigger', label: 'Start' },
      { id: 'n2', type: 'email', label: 'Send Alert Email' },
    ],
    edges: [{ sourceNodeId: 'n1', targetNodeId: 'n2' }],
    upstreamOutputs: { n1: {} },
  },
};

describe('buildHealingPrompt', () => {
  it('includes the error message', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('connect ECONNREFUSED 127.0.0.1:587');
  });

  it('includes the node type and label', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('email');
    expect(prompt).toContain('Send Alert Email');
  });

  it('includes node config', () => {
    const prompt = buildHealingPrompt(mockContext);
    expect(prompt).toContain('john@example.com');
  });

  it('includes previous attempts when present', () => {
    const ctx: HealingContext = {
      ...mockContext,
      previousAttempts: [{
        diagnosis: 'SMTP not configured',
        fixApplied: 'Changed host to smtp.gmail.com',
        resultError: 'Authentication failed',
      }],
    };
    const prompt = buildHealingPrompt(ctx);
    expect(prompt).toContain('SMTP not configured');
    expect(prompt).toContain('Authentication failed');
  });
});

describe('parseHealingResponse', () => {
  it('parses a valid config_fix response', () => {
    const raw = JSON.stringify({
      category: 'config_fix',
      diagnosis: 'Expression accesses wrong path',
      reasoning: 'The http-request wraps response in body field',
      fix: {
        type: 'update_config',
        changes: { expression: 'return input.body.data' },
        description: 'Fixed expression to use input.body',
      },
      confidence: 'high',
    });
    const result = parseHealingResponse(raw);
    expect(result.category).toBe('config_fix');
    expect(result.fix?.type).toBe('update_config');
    expect(result.fix?.changes.expression).toBe('return input.body.data');
  });

  it('parses an environment_issue response', () => {
    const raw = JSON.stringify({
      category: 'environment_issue',
      diagnosis: 'No SMTP server running on localhost',
      reasoning: 'The error indicates connection refused on port 587',
      fix: null,
      environmentAction: 'Add SMTP_HOST to .env',
      alternative: 'Use HTTP Request with Resend API instead',
      confidence: 'high',
    });
    const result = parseHealingResponse(raw);
    expect(result.category).toBe('environment_issue');
    expect(result.fix).toBeNull();
    expect(result.environmentAction).toContain('SMTP_HOST');
  });

  it('returns unknown category for unparseable response', () => {
    const result = parseHealingResponse('not json');
    expect(result.category).toBe('unknown');
  });
});
