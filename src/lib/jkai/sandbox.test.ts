import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sliceBase64, writeFileInSandboxChunked, type ExecResult } from './sandbox';

// syncExplainerKit needs to chunk three.min.js's base64 (~893KB) into pieces
// small enough to survive as individual shell arguments (Linux caps a single
// argument at MAX_ARG_STRLEN, 128KB) when not in HOST_MODE. sliceBase64 is the
// pure slicing step behind that — this only tests that slicing and rejoining
// is lossless, not the shell round-trip itself (which needs a sandbox).
describe('sliceBase64', () => {
  it('rejoins to the original input for input larger than the slice size', () => {
    // A uniform byte stream (e.g. 'x'.repeat(n)) base64-encodes to a
    // low-period repeating string, and since 60,000 is a multiple of 4 every
    // full slice would be byte-identical to every other — so join('') would
    // still equal the original even if the slices came out in the wrong
    // order. Random bytes make content equality load-bearing against
    // reordering, not just truncation.
    const b64 = randomBytes(150_000).toString('base64');
    expect(b64.length).toBeGreaterThan(60_000);
    const slices = sliceBase64(b64, 60_000);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices.join('')).toBe(b64);
  });

  it('produces slices no longer than the requested size', () => {
    const b64 = Buffer.from('y'.repeat(150_000)).toString('base64');
    const slices = sliceBase64(b64, 60_000);
    for (const s of slices) {
      expect(s.length).toBeLessThanOrEqual(60_000);
    }
  });

  it('returns a single slice when the input is already under the threshold', () => {
    const b64 = Buffer.from('small').toString('base64');
    const slices = sliceBase64(b64, 60_000);
    expect(slices).toEqual([b64]);
  });

  it('uses the default threshold when size is omitted', () => {
    // Same reordering concern as the first test — random bytes, not a
    // repeating pattern.
    const b64 = randomBytes(150_000).toString('base64');
    const slices = sliceBase64(b64);
    expect(slices.join('')).toBe(b64);
    expect(slices.length).toBeGreaterThan(1);
  });
});

// writeFileInSandboxChunked must never leave a corrupt artifact behind on
// failure — a truncated/partial three.min.js is worse than a missing one
// (that's the whole reason it verifies the decoded byte count in the first
// place). These stub `exec` to simulate each of the three failure modes and
// assert both that a cleanup command removing the `.b64` side file AND the
// destination path was issued, and that the function reports failure.
describe('writeFileInSandboxChunked cleanup on failure', () => {
  const filePath = '/home/jkai/workspace/build-1/dev/explainer-kit/three.min.js';
  const b64Path = `${filePath}.b64`;

  function ok(stdout = ''): ExecResult {
    return { stdout, stderr: '', exitCode: 0 };
  }
  function fail(stderr: string): ExecResult {
    return { stdout: '', stderr, exitCode: 1 };
  }

  function cleanupCall(calls: string[]): string | undefined {
    return calls.find((c) => c.startsWith('rm -f') && c.includes(b64Path) && c.includes(filePath));
  }

  it('cleans up both paths when a chunk write fails', async () => {
    const calls: string[] = [];
    const exec = vi.fn(async (cmd: string): Promise<ExecResult> => {
      calls.push(cmd);
      if (cmd.startsWith('printf')) return fail('printf: cannot write: No space left on device');
      return ok();
    });

    const result = await writeFileInSandboxChunked(filePath, 'small content', exec);

    expect(result.exitCode).not.toBe(0);
    expect(cleanupCall(calls)).toBeDefined();
    // The write never got past the first chunk, so decode must never run.
    expect(calls.some((c) => c.includes('base64 -d'))).toBe(false);
  });

  it('cleans up both paths when the decode step fails', async () => {
    const calls: string[] = [];
    const exec = vi.fn(async (cmd: string): Promise<ExecResult> => {
      calls.push(cmd);
      if (cmd.startsWith('printf')) return ok();
      if (cmd.includes('base64 -d')) return fail('base64: invalid input');
      return ok();
    });

    const result = await writeFileInSandboxChunked(filePath, 'small content', exec);

    expect(result.exitCode).not.toBe(0);
    expect(cleanupCall(calls)).toBeDefined();
  });

  it('cleans up both paths when the decoded byte count does not match', async () => {
    const content = 'small content';
    const calls: string[] = [];
    const exec = vi.fn(async (cmd: string): Promise<ExecResult> => {
      calls.push(cmd);
      if (cmd.startsWith('printf')) return ok();
      if (cmd.includes('base64 -d')) return ok();
      if (cmd.startsWith('wc -c')) return ok(String(Buffer.byteLength(content) - 1)); // wrong count
      return ok();
    });

    const result = await writeFileInSandboxChunked(filePath, content, exec);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/verification failed/);
    expect(cleanupCall(calls)).toBeDefined();
  });

  it('does not clean up on success', async () => {
    const content = 'small content';
    const calls: string[] = [];
    const exec = vi.fn(async (cmd: string): Promise<ExecResult> => {
      calls.push(cmd);
      if (cmd.startsWith('printf')) return ok();
      if (cmd.includes('base64 -d')) return ok();
      if (cmd.startsWith('wc -c')) return ok(String(Buffer.byteLength(content)));
      return ok();
    });

    const result = await writeFileInSandboxChunked(filePath, content, exec);

    expect(result.exitCode).toBe(0);
    expect(cleanupCall(calls)).toBeUndefined();
  });
});
