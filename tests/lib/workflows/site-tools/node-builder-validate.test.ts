import { describe, it, expect, vi, beforeEach } from 'vitest';
import '$lib/workflows/site-tools/tools/node-builder';
import { getTool } from '$lib/workflows/site-tools/registry';

vi.mock('$lib/workflows/site-tools/tools/node-builder-shared', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import(
    '$lib/workflows/site-tools/tools/node-builder-shared'
  );
  return {
    ...actual,
    runProcess: vi.fn(),
  };
});

describe('node_builder_validate', () => {
  let runProcessMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const shared = await import('$lib/workflows/site-tools/tools/node-builder-shared');
    runProcessMock = shared.runProcess as ReturnType<typeof vi.fn>;
    runProcessMock.mockReset();
  });

  it('runs npm build, svelte-kit sync, and svelte-check; returns ok when all succeed', async () => {
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'build ok', stderr: '', exitCode: 0 });
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'sync ok', stderr: '', exitCode: 0 });
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'check ok', stderr: '', exitCode: 0 });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    expect(runProcessMock).toHaveBeenCalledTimes(3);
    expect(runProcessMock.mock.calls[0][0]).toBe('npm');
    expect(runProcessMock.mock.calls[0][1]).toEqual(['run', 'build']);
    expect(runProcessMock.mock.calls[1][0]).toBe('npx');
    expect(runProcessMock.mock.calls[1][1]).toEqual(['svelte-kit', 'sync']);
    expect(runProcessMock.mock.calls[2][0]).toBe('npx');
    expect(runProcessMock.mock.calls[2][1]).toEqual([
      'svelte-check',
      '--tsconfig',
      './tsconfig.json',
      '--threshold',
      'error',
    ]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('returns ok:false with errors when build fails (skips sync + check)', async () => {
    runProcessMock.mockResolvedValueOnce({
      ok: false,
      stdout: '',
      stderr: 'TypeError: foo',
      exitCode: 1,
    });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    expect(runProcessMock).toHaveBeenCalledTimes(1); // skips sync + check if build failed
    expect(result.success).toBe(true);
    const data = result.data as { ok: boolean; errors?: string };
    expect(data.ok).toBe(false);
    expect(data.errors).toContain('TypeError: foo');
  });

  it('returns ok:false when svelte-kit sync fails (skips check)', async () => {
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'build ok', stderr: '', exitCode: 0 });
    runProcessMock.mockResolvedValueOnce({
      ok: false,
      stdout: '',
      stderr: 'sync failed: cannot resolve $types',
      exitCode: 1,
    });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    expect(runProcessMock).toHaveBeenCalledTimes(2); // skips check if sync failed
    const data = result.data as { ok: boolean; errors?: string };
    expect(data.ok).toBe(false);
    expect(data.errors).toContain('svelte-kit sync failed');
    expect(data.errors).toContain('sync failed: cannot resolve $types');
  });

  it('returns ok:false with errors when svelte-check finds real errors (warnings ignored via --threshold error)', async () => {
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'build ok', stderr: '', exitCode: 0 });
    runProcessMock.mockResolvedValueOnce({ ok: true, stdout: 'sync ok', stderr: '', exitCode: 0 });
    runProcessMock.mockResolvedValueOnce({
      ok: false,
      stdout: '',
      stderr: 'svelte-check found 1 error',
      exitCode: 1,
    });

    const tool = getTool('node_builder_validate')!;
    const result = await tool.handler({});

    expect(runProcessMock).toHaveBeenCalledTimes(3);
    const data = result.data as { ok: boolean; errors?: string };
    expect(data.ok).toBe(false);
    expect(data.errors).toContain('svelte-check found errors');
    expect(data.errors).toContain('svelte-check found 1 error');
  });
});
