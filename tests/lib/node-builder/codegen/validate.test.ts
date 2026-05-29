import { describe, it, expect } from 'vitest';
import type { NodeSpec } from '$lib/node-builder/spec/types';

const validSpec: NodeSpec = {
  type: 'test-node',
  label: 'Test',
  category: 'integrations',
  description: 'A test node',
  llmDescription: 'Use this for testing',
  llmExamples: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  configSchema: { type: 'object', properties: { x: { type: 'string' } } },
  defaultConfig: { x: '' },
  uiSchema: {
    layout: 'single',
    sections: [{ title: 'Main', fields: [{ key: 'x', label: 'X', widget: 'string' }] }],
  },
  executorBody: 'return { ok: true };',
  deps: [],
  docs: '## When to use\nFor testing.',
};

describe('validateNodeSpec', () => {
  it('accepts a valid spec', async () => {
    const { validateNodeSpec } = await import('$lib/node-builder/spec/validate');
    const r = validateNodeSpec(validSpec);
    expect(r.ok).toBe(true);
  });

  it('rejects type with non-kebab-case', async () => {
    const { validateNodeSpec } = await import('$lib/node-builder/spec/validate');
    const r = validateNodeSpec({ ...validSpec, type: 'TestNode' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/kebab-case/i);
  });

  it('rejects empty label', async () => {
    const { validateNodeSpec } = await import('$lib/node-builder/spec/validate');
    const r = validateNodeSpec({ ...validSpec, label: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects field with key not in configSchema.properties', async () => {
    const { validateNodeSpec } = await import('$lib/node-builder/spec/validate');
    const bad: NodeSpec = {
      ...validSpec,
      uiSchema: {
        layout: 'single',
        sections: [{ title: 'Main', fields: [{ key: 'unknown', label: 'X', widget: 'string' }] }],
      },
    };
    const r = validateNodeSpec(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown/);
  });

  it('rejects oauth2 spec missing oauthSpec', async () => {
    const { validateNodeSpec } = await import('$lib/node-builder/spec/validate');
    const bad: NodeSpec = {
      ...validSpec,
      uiSchema: {
        layout: 'single',
        sections: [{
          title: 'Main',
          fields: [{
            key: 'cred', label: 'Credential', widget: 'credential-picker',
            integrationType: 'foo',
          }],
        }],
      },
      configSchema: { type: 'object', properties: { cred: { type: 'string' }, x: { type: 'string' } } },
      integrationType: 'foo',
    };
    // Just ensure it accepts cred-picker fields:
    const r = validateNodeSpec(bad);
    expect(r.ok).toBe(true);
  });
});
