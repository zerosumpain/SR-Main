import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool as rawExecuteTool } from '$lib/tools/registry';
import { ownerActionPrincipal } from '$lib/tools/in-process-principal';

// Authoring and promoting run model-written code: destructive tools, reached
// only by an attended owner (here, an owner press).
const executeTool = (name: string, args: Record<string, unknown>) =>
  rawExecuteTool(name, args, { emit: () => {}, principal: ownerActionPrincipal('test') });

beforeAll(async () => {
  await import('$lib/tools/tools/visualise');
  await import('$lib/tools/tools/ephemeral-tools');
});

describe('author_ephemeral_tool', () => {
  it('is registered', () => {
    expect(getTool('author_ephemeral_tool')).toBeDefined();
  });

  it('runs a handler that composes a primitive via platform.call', async () => {
    const res = await executeTool('author_ephemeral_tool', {
      name: 'small_table',
      description: 'Renders a small table',
      parameters: { type: 'object', properties: {} },
      handlerCode: `
        return await platform.call('render_table', {
          columns: [{ key: 'name', label: 'Name' }],
          rows: [{ name: 'Example' }],
        });
      `,
      callArgs: {},
    });
    expect(res.success).toBe(true);
    const data = res.data as {
      artifact?: { type?: string };
      summary?: string;
      __ephemeral__?: { handlerCode: string; proposedName: string };
    };
    expect(data.artifact?.type).toBe('table');
    expect(data.__ephemeral__?.proposedName).toBe('small_table');
    expect(data.__ephemeral__?.handlerCode).toMatch(/render_table/);
  });

  it('fails cleanly on a handlerCode syntax error', async () => {
    const res = await executeTool('author_ephemeral_tool', {
      name: 'broken',
      description: 'broken',
      parameters: { type: 'object', properties: {} },
      handlerCode: 'this is not valid JS ;;;;;',
      callArgs: {},
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/syntax|parse|unexpected/i);
  });

  it('does NOT register the ephemeral tool in the main registry', async () => {
    await executeTool('author_ephemeral_tool', {
      name: 'should_not_persist',
      description: 'x',
      parameters: { type: 'object', properties: {} },
      handlerCode: `return { success: true, data: { artifact: { type: 'table', columns: [{key:'x',label:'X'}], rows: [{x:1}] }, summary: 'one' } };`,
      callArgs: {},
    });
    expect(getTool('should_not_persist')).toBeUndefined();
  });
});
