import { describe, it, expect } from 'vitest';
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';

describe('extractEphemeralSidecar', () => {
  it('moves __ephemeral__ out of result.data into step.ephemeral', () => {
    const step = {
      id: 'step-1',
      tool: 'author_ephemeral_tool',
      args: {},
      status: 'done' as const,
      result: {
        success: true,
        data: {
          artifact: { type: 'chart' },
          summary: 'x',
          __ephemeral__: {
            handlerCode: 'return { success: true };',
            parameters: { type: 'object', properties: {} },
            proposedName: 'foo',
            proposedDescription: 'does foo',
          },
        },
      },
    };
    const out = extractEphemeralSidecar(step);
    expect(out.ephemeral).toEqual({
      handlerCode: 'return { success: true };',
      parameters: { type: 'object', properties: {} },
      proposedName: 'foo',
      proposedDescription: 'does foo',
    });
    const data = (out.result as { data: Record<string, unknown> }).data;
    expect('__ephemeral__' in data).toBe(false);
    expect(data.artifact).toBeDefined();
  });

  it('is a no-op for non-ephemeral steps', () => {
    const step = {
      id: 'step-2',
      tool: 'render_chart',
      args: {},
      status: 'done' as const,
      result: { success: true, data: { artifact: { type: 'chart' }, summary: 'x' } },
    };
    const out = extractEphemeralSidecar(step);
    expect(out.ephemeral).toBeUndefined();
    expect(out).toEqual(step);
  });
});
