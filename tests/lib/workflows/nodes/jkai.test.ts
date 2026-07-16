import { describe, it, expect, vi, beforeEach } from 'vitest';

// jkai.ts statically imports executeSiteTool from the site-tools executor,
// which would pull the whole (server-only) tool registry. Mock it so we can
// assert the exact tool names + arg shapes the node maps operations onto.
const { executeSiteTool } = vi.hoisted(() => ({ executeSiteTool: vi.fn() }));

vi.mock('$lib/workflows/site-tools/executor', () => ({
  executeSiteTool,
  isRegisteredTool: () => true,
}));

import { jkaiExecutor } from '$lib/workflows/nodes/jkai';

const ctx: any = { runId: 'r', workflowId: 'w', emit: vi.fn(), getNodeOutput: () => undefined };

beforeEach(() => {
  executeSiteTool.mockReset();
  executeSiteTool.mockResolvedValue({ success: true, data: {} });
});

describe('jkai node → build_* tool names', () => {
  it('start → build_create with { prompt, title }', async () => {
    executeSiteTool.mockResolvedValueOnce({ success: true, data: { id: 'b1' } });
    await jkaiExecutor.execute(
      { topic: 'a timer' },
      { operation: 'start', prompt: 'Build {{input.topic}}', title: 'Timer' },
      ctx,
    );
    expect(executeSiteTool).toHaveBeenCalledWith('build_create', { prompt: 'Build a timer', title: 'Timer' });
  });

  it('start without prompt → error, no tool call', async () => {
    const r = await jkaiExecutor.execute({}, { operation: 'start' }, ctx);
    expect(r.output).toMatchObject({ success: false });
    expect(executeSiteTool).not.toHaveBeenCalled();
  });

  it('status → build_inspect with { id }', async () => {
    await jkaiExecutor.execute({ data: { id: 'b7' } }, { operation: 'status', buildId: '{{input.data.id}}' }, ctx);
    expect(executeSiteTool).toHaveBeenCalledWith('build_inspect', { id: 'b7' });
  });

  it('list → build_list and rowCount reflects data array length', async () => {
    executeSiteTool.mockResolvedValueOnce({ success: true, data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const r = await jkaiExecutor.execute({}, { operation: 'list' }, ctx);
    expect(executeSiteTool).toHaveBeenCalledWith('build_list', {});
    expect(r.rowCount).toBe(3);
  });

  it('control → build_control with { id, action }', async () => {
    await jkaiExecutor.execute({}, { operation: 'control', buildId: 'b2', action: 'pause' }, ctx);
    expect(executeSiteTool).toHaveBeenCalledWith('build_control', { id: 'b2', action: 'pause' });
  });

  it('control maps legacy "cancel" action to "stop"', async () => {
    await jkaiExecutor.execute({}, { operation: 'control', buildId: 'b2', action: 'cancel' }, ctx);
    expect(executeSiteTool).toHaveBeenCalledWith('build_control', { id: 'b2', action: 'stop' });
  });

  it('control without buildId → error, no tool call', async () => {
    const r = await jkaiExecutor.execute({}, { operation: 'control', action: 'pause' }, ctx);
    expect(r.output).toMatchObject({ success: false });
    expect(executeSiteTool).not.toHaveBeenCalled();
  });

  it('never calls the stale jkai_* tool names', async () => {
    await jkaiExecutor.execute({ data: { id: 'b1' } }, { operation: 'status', buildId: '{{input.data.id}}' }, ctx);
    for (const [name] of executeSiteTool.mock.calls) {
      expect(String(name).startsWith('jkai_')).toBe(false);
    }
  });
});
