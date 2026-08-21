import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  sliceBase64,
  writeFileInSandboxChunked,
  seedDevCommand,
  parseBuiltChapterCount,
  reclaimDepsCommand,
  parseReclaimedBytes,
  depsMissingCommand,
  type ExecResult,
} from './sandbox';

// The seed step opens every iteration. Its unconditional `rm -rf` across dev/
// destroyed 57% of build 85dac418's tokens: promotion only ran on the happy
// path, so any iteration that ended early had its files deleted at the start
// of the next one — while the in-code comments promised the opposite.
describe('seedDevCommand', () => {
  const BASE = '/home/jkai/workspace/b1';

  it('does NOT delete dev/ when the previous iteration never promoted', () => {
    const cmd = seedDevCommand(BASE, true);
    expect(cmd).not.toContain('rm -rf');
    expect(cmd).toContain(`cp -a ${BASE}/live/. ${BASE}/dev/`);
  });

  it('clears dev/ first in the normal case, so a deleted file stays deleted', () => {
    // The overlay-only form is a data-loss guard, not a general improvement:
    // used unconditionally it would resurrect files the agent meant to remove.
    const cmd = seedDevCommand(BASE, false);
    expect(cmd).toContain(`find ${BASE}/dev -mindepth 1 -maxdepth 1 -exec rm -rf {} +`);
    expect(cmd.indexOf('rm -rf')).toBeLessThan(cmd.indexOf('cp -a'));
  });
});

describe('parseBuiltChapterCount', () => {
  it.each([
    ['3\n', 3],
    ['0\n', 0],
    ['  12  ', 12],
  ])('reads %o as %i', (stdout, want) => {
    expect(parseBuiltChapterCount(stdout)).toBe(want);
  });

  // Unreadable output must make FEWER chapters due, never more — a high guess
  // manufactures still-placeholder findings for chapters nobody has reached.
  it.each([[''], ['grep: no such file'], ['   '], [undefined as unknown as string]])(
    'falls back to 0 for %o',
    (stdout) => {
      expect(parseBuiltChapterCount(stdout)).toBe(0);
    },
  );
});

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

// The reclaim sweep runs `rm -rf` inside workspaces that hold uncommitted
// agent work — 23 of them did when this was written. What it deletes is
// therefore a property to pin, not something to re-read carefully each time.
describe('reclaimDepsCommand', () => {
  const BASE = '/home/jkai/workspace/b1';

  it('deletes the two node_modules trees and nothing else', () => {
    const cmd = reclaimDepsCommand(BASE);
    const removed = [...cmd.matchAll(/rm -rf ([^;]+)/g)]
      .flatMap((m) => m[1].trim().split(/\s+/))
      .filter((tok) => tok.startsWith('/')); // drop the 2>/dev/null redirect
    expect(removed).toEqual([`${BASE}/dev/node_modules`, `${BASE}/live/node_modules`]);
  });

  it.each(['dev/src', 'live/src', 'dev/.git', 'live/.git', 'snapshots', 'dev/build'])(
    'never targets %s',
    (path) => {
      expect(reclaimDepsCommand(BASE)).not.toContain(`rm -rf ${BASE}/${path}`);
    },
  );

  it('sizes before it deletes, or the freed total is always zero', () => {
    const cmd = reclaimDepsCommand(BASE);
    expect(cmd.indexOf('du -sb')).toBeLessThan(cmd.indexOf('rm -rf'));
  });
});

describe('parseReclaimedBytes', () => {
  it('reads du total from the first line, ignoring the trailing marker', () => {
    expect(parseReclaimedBytes('2684354560\ndone\n')).toBe(2684354560);
  });

  // An unreadable total must under-report, never invent a number: the figure
  // is logged as reclaimed GB and a wrong one hides a sweep that did nothing.
  it.each([[''], ['done'], ['   '], ['-5\ndone'], [undefined as unknown as string]])(
    'falls back to 0 for %o',
    (stdout) => {
      expect(parseReclaimedBytes(stdout)).toBe(0);
    },
  );
});

describe('depsMissingCommand', () => {
  const DEV = '/home/jkai/workspace/b1/dev';

  // Both conditions matter. A plain-HTML build has no package.json, and
  // reporting it "missing" would run npm install there on every iteration
  // forever.
  it('requires both a package.json and an absent node_modules', () => {
    const cmd = depsMissingCommand(DEV);
    expect(cmd).toContain(`[ -f ${DEV}/package.json ]`);
    expect(cmd).toContain(`[ ! -d ${DEV}/node_modules ]`);
    expect(cmd).toContain('&&');
  });

  it('echoes ok in the negative case, so a failed check never installs', () => {
    expect(depsMissingCommand(DEV)).toMatch(/else echo ok/);
  });
});
