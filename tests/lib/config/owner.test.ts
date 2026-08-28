import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

const dyn = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => dyn);

describe('ownerPhone', () => {
  beforeEach(async () => {
    vi.resetModules();
    dyn.env = {};
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns the configured number', async () => {
    dyn.env.WORKFLOW_NOTIFY_PHONE = '+447700900123';
    const { ownerPhone } = await import('$lib/config/owner');
    expect(ownerPhone()).toBe('+447700900123');
  });

  it('trims surrounding whitespace, which a hand-edited .env line carries', async () => {
    dyn.env.WORKFLOW_NOTIFY_PHONE = '  +447700900123  ';
    const { ownerPhone } = await import('$lib/config/owner');
    expect(ownerPhone()).toBe('+447700900123');
  });

  it('returns null when unset rather than falling back to a literal', async () => {
    // The whole point. A default here is how the number gets back into source.
    const { ownerPhone } = await import('$lib/config/owner');
    expect(ownerPhone()).toBeNull();
  });

  it('treats an empty or whitespace-only value as unset', async () => {
    dyn.env.WORKFLOW_NOTIFY_PHONE = '   ';
    const { ownerPhone } = await import('$lib/config/owner');
    expect(ownerPhone()).toBeNull();
  });

  it('says so loudly, once, when it is unset', async () => {
    // Silent absence is the failure mode: alerts just stop arriving with
    // nothing anywhere to say why. But these sit on hot paths, so it must not
    // log per call.
    const { ownerPhone } = await import('$lib/config/owner');
    ownerPhone();
    ownerPhone();
    ownerPhone();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('WORKFLOW_NOTIFY_PHONE');
  });
});

describe("the owner's number is not in the source tree", () => {
  // A grep, because the defect is recurrence: the number was in five runtime
  // constants and ten documentation examples, and it reached a model on every
  // turn via the always-on capabilities prompt. Any new literal must fail here.
  //
  // Test files are excluded deliberately — several of them assert that this
  // exact number IS detected and redacted, so the real value is the fixture.
  //
  // SCOPED TO WHAT GIT WOULD PUBLISH, not to what is on the disk. This used to
  // be a plain `grep -r` over src and packages, which also read build output:
  // packages/jkai-run-worker/dist/ is gitignored, is regenerated from bin/, and
  // legitimately inlines ownerPhone()'s runtime value — so anyone who had built
  // the worker locally failed this test while CI, on a clean checkout, stayed
  // green. A security guard that cries wolf on a developer's own disk is one
  // people learn to skip, which costs more than it protects.
  //
  // `--cached --others --exclude-standard` is tracked files PLUS untracked ones
  // that are not ignored — everything that could reach the public repo, which is
  // exactly the risk. A new source file with the number in it still fails here
  // before it is ever committed.
  it('appears in no non-test source file', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'packages'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    )
      .split('\n')
      .filter((f) => /\.(ts|svelte|js)$/.test(f) && !/\.test\.ts$/.test(f));

    // The file list is what is most likely to silently become empty — a bad
    // pathspec, a git that errors — and an empty list passes while checking
    // nothing, which is the failure this guard exists to prevent.
    expect(files.length).toBeGreaterThan(500);

    const hits = files
      .flatMap((f) => {
        const lines = readFileSync(resolve(ROOT, f), 'utf8').split('\n');
        return lines
          .map((line, i) => (line.includes('447359228511') ? `${f}:${i + 1}: ${line.trim()}` : null))
          .filter(Boolean);
      })
      .join('\n');
    expect(hits, `the owner's number must not be hard-coded:\n${hits}`).toBe('');
  });

  it('is not appended to the always-on capabilities prompt as a literal', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/workflows/site-tools/registry.ts'), 'utf8');
    expect(src).toContain('ownerPhone()');
    expect(src).not.toMatch(/John's WhatsApp number: \+\d/);
  });
});
