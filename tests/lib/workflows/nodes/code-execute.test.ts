import { describe, it, expect, vi } from 'vitest';
import { codeExecuteExecutor, codeExecuteDef } from '$lib/workflows/nodes/code-execute';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the sandbox module
vi.mock('$lib/jkai/sandbox', () => ({
  ensureSandboxRunning: vi.fn(),
  execInSandbox: vi.fn(),
  writeFileInSandbox: vi.fn(),
}));

import { execInSandbox, ensureSandboxRunning, writeFileInSandbox } from '$lib/jkai/sandbox';

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
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
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
    expect(ensureSandboxRunning).toHaveBeenCalled();
  });

  it('executes python code in sandbox', async () => {
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
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
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
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
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
      stdout: '',
      stderr: 'syntax error',
      exitCode: 1,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'python', code: 'bad code' },
      mockContext,
    );

    expect(result.output).toHaveProperty('error');
    expect(result.output.exitCode).toBe(1);
  });

  it('has correct type', () => {
    expect(codeExecuteExecutor.type).toBe('code-execute');
  });

  it('skips execution entirely on dryRun and returns a simulated result', async () => {
    vi.mocked(ensureSandboxRunning).mockClear();
    vi.mocked(execInSandbox).mockClear();
    vi.mocked(writeFileInSandbox).mockClear();

    const result = await codeExecuteExecutor.execute(
      { value: 5 },
      { language: 'javascript', code: 'console.log("should not run")' },
      { ...mockContext, dryRun: true },
    );

    expect(result.output).toMatchObject({ simulated: true });
    expect(result.logs?.[0]).toContain('skipped-for-dry-run');
    // Critically: no sandbox interaction at all.
    expect(ensureSandboxRunning).not.toHaveBeenCalled();
    expect(execInSandbox).not.toHaveBeenCalled();
    expect(writeFileInSandbox).not.toHaveBeenCalled();
  });
});

describe('codeExecuteDef', () => {
  it('is a core category', () => {
    expect(codeExecuteDef.category).toBe('core');
  });
});
