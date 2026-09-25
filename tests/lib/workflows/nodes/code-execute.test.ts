import { describe, it, expect, vi } from 'vitest';
import { codeExecuteExecutor, codeExecuteDef } from '$lib/workflows/nodes/code-execute';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the sandbox module
vi.mock('$lib/jkai/sandbox', () => ({
  ensureContainerRunning: vi.fn(),
  execInContainer: vi.fn(),
  writeFileInContainer: vi.fn(),
}));

import { execInContainer, ensureContainerRunning, writeFileInContainer } from '$lib/jkai/sandbox';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

describe('codeExecuteExecutor', () => {
  it('executes javascript code in sandbox', async () => {
    vi.mocked(ensureContainerRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined as any);
    vi.mocked(execInContainer).mockResolvedValue({
      stdout: '{"doubled":10}',
      stderr: '',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      { value: 5 },
      { language: 'javascript', code: 'console.log(JSON.stringify({ doubled: input.value * 2 }))' },
      mockContext,
    );

    expect(result.output).toEqual({ doubled: 10 });
    expect(ensureContainerRunning).toHaveBeenCalled();
  });

  it('executes python code in sandbox', async () => {
    vi.mocked(ensureContainerRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined as any);
    vi.mocked(execInContainer).mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'python', code: 'print(json.dumps({"result": "ok"}))' },
      mockContext,
    );

    expect(result.output).toEqual({ result: 'ok' });
  });

  it('captures stderr in logs', async () => {
    vi.mocked(ensureContainerRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined as any);
    vi.mocked(execInContainer).mockResolvedValue({
      stdout: '{}',
      stderr: 'some warning',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'bash', code: 'echo "{}"' },
      mockContext,
    );

    expect(result.logs).toContain('some warning');
  });

  it('returns error on non-zero exit code', async () => {
    vi.mocked(ensureContainerRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInContainer).mockResolvedValue(undefined as any);
    vi.mocked(execInContainer).mockResolvedValue({
      stdout: '',
      stderr: 'syntax error',
      exitCode: 1,
    });

    await expect(codeExecuteExecutor.execute(
      {},
      { language: 'python', code: 'bad code' },
      mockContext,
    )).rejects.toThrow('Exit code 1: syntax error');
  });

  it('has correct type', () => {
    expect(codeExecuteExecutor.type).toBe('code-execute');
  });

});

describe('codeExecuteDef', () => {
  it('is a core category', () => {
    expect(codeExecuteDef.category).toBe('core');
  });
});
