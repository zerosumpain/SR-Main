import { describe, it, expect, vi, beforeEach } from 'vitest';

// The site-tool executor dynamic-imports the registry; mock it so the real
// (server-only) domain tool tree is never loaded. `registryTools` is a mutable
// map each test seeds.
const { registryTools } = vi.hoisted(() => ({ registryTools: {} as Record<string, any> }));

vi.mock('$lib/workflows/site-tools/registry', () => ({
  getTool: (name: string) => registryTools[name],
  getToolDefinitions: () =>
    Object.values(registryTools).map((t: any) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? { type: 'object' } },
    })),
}));

import { siteToolExecutor } from '$lib/workflows/nodes/site-tool';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return makeExecutionContext({
    runId: 'r1',
    workflowId: 'w1',
    workspaceDir: '/tmp',
    _currentNodeId: 'st-1',
    ...overrides,
  });
}

beforeEach(() => {
  for (const k of Object.keys(registryTools)) delete registryTools[k];
  registryTools.save_memory = {
    name: 'save_memory',
    description: 'Save a fact',
    parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
    destructive: false,
    handler: vi.fn().mockResolvedValue({ success: true, data: { id: 'm1' } }),
  };
  registryTools.whatsapp_send = {
    name: 'whatsapp_send',
    description: 'Send a WhatsApp message',
    parameters: { type: 'object', properties: { message: { type: 'string' } } },
    destructive: true,
    handler: vi.fn().mockResolvedValue({ success: true, data: { sent: true } }),
  };
});

describe('site-tool executor — gating matrix', () => {
  it('unknown tool → throws with did-you-mean candidates', async () => {
    await expect(
      siteToolExecutor.execute({}, { toolName: 'save_memry', args: { content: 'x' } }, makeCtx()),
    ).rejects.toThrow(/unknown tool "save_memry".*save_memory/is);
  });

  it('denylisted tool → throws, never looks it up', async () => {
    await expect(
      siteToolExecutor.execute({}, { toolName: 'build_delete', args: {} }, makeCtx()),
    ).rejects.toThrow(/denylisted/i);
    await expect(
      siteToolExecutor.execute({}, { toolName: 'node_builder_write_files', args: {} }, makeCtx()),
    ).rejects.toThrow(/denylisted/i);
    await expect(
      siteToolExecutor.execute({}, { toolName: 'author_ephemeral_tool', args: {} }, makeCtx()),
    ).rejects.toThrow(/denylisted/i);
  });

  it('destructive tool without allowDestructive → throws, handler not invoked', async () => {
    await expect(
      siteToolExecutor.execute({}, { toolName: 'whatsapp_send', args: { message: 'hi' } }, makeCtx()),
    ).rejects.toThrow(/destructive/i);
    expect(registryTools.whatsapp_send.handler).not.toHaveBeenCalled();
  });

  it('destructive + allowDestructive but NO upstream approval → throws, handler not invoked', async () => {
    await expect(
      siteToolExecutor.execute(
        {},
        { toolName: 'whatsapp_send', args: { message: 'hi' }, allowDestructive: true },
        makeCtx(),
      ),
    ).rejects.toThrow(/no approval node/i);
    expect(registryTools.whatsapp_send.handler).not.toHaveBeenCalled();
  });

  it('destructive + allowDestructive WITH upstream approval → invokes', async () => {
    const ctx = makeCtx({
      getIncomingEdges: (id: string) =>
        id === 'st-1'
          ? [{ id: 'e1', sourceNodeId: 'approval-1', targetNodeId: 'st-1' }]
          : [],
      getNodeConfig: (id: string) =>
        id === 'approval-1' ? { type: 'approval', config: {}, label: 'Approve' } : undefined,
    });
    const result = await siteToolExecutor.execute(
      {},
      { toolName: 'whatsapp_send', args: { message: 'hi' }, allowDestructive: true },
      ctx,
    );
    expect(registryTools.whatsapp_send.handler).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hi' }),
      expect.anything(),
    );
    expect(result.output).toMatchObject({ success: true, toolName: 'whatsapp_send', data: { sent: true } });
  });

  it('dryRun short-circuits ANY tool (even destructive) without invoking', async () => {
    const result = await siteToolExecutor.execute(
      {},
      { toolName: 'whatsapp_send', args: { message: 'hi' }, allowDestructive: true },
      makeCtx({ dryRun: true }),
    );
    expect(result.output).toMatchObject({ dryRun: true, wouldInvoke: 'whatsapp_send' });
    expect(registryTools.whatsapp_send.handler).not.toHaveBeenCalled();
    expect(registryTools.save_memory.handler).not.toHaveBeenCalled();
  });

  it('success → unwraps { success, toolName, data }', async () => {
    const result = await siteToolExecutor.execute(
      {},
      { toolName: 'save_memory', args: { content: 'a fact' } },
      makeCtx(),
    );
    expect(result.output).toEqual({ success: true, toolName: 'save_memory', data: { id: 'm1' } });
  });

  it('interpolates {{input.*}} into string args', async () => {
    await siteToolExecutor.execute(
      { fact: 'John likes tea' },
      { toolName: 'save_memory', args: { content: '{{input.fact}}' } },
      makeCtx(),
    );
    expect(registryTools.save_memory.handler).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'John likes tea' }),
      expect.anything(),
    );
  });

  it('tool returning { success:false } → throws (routes to _onError path)', async () => {
    registryTools.save_memory.handler.mockResolvedValueOnce({ success: false, error: 'store offline' });
    await expect(
      siteToolExecutor.execute({}, { toolName: 'save_memory', args: { content: 'x' } }, makeCtx()),
    ).rejects.toThrow(/store offline/);
  });

  it('missing toolName → throws', async () => {
    await expect(siteToolExecutor.execute({}, { args: {} }, makeCtx())).rejects.toThrow(/no toolName/i);
  });
});
