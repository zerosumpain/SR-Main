import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The builder's systemd unit is the deployed artifact — `scripts/deploy-builder.sh`
 * copies this exact file to /etc/systemd/system — so a mistake in it is a
 * production mistake, and the class of mistake it makes is not a crash at deploy
 * time. It is a sandbox that denies something the orchestrator needs, which shows
 * up later as a failed build with an errno in it.
 *
 * That happened on 2026-09-04: PR #670 added ProtectHome=read-only with a
 * ReadWritePaths list that omitted pi's own config directory. The service started
 * fine, `systemctl status` was green, /health answered, and every single build
 * from then until it was found died at `pi` startup with EROFS. Nothing about the
 * unit looked wrong; the missing entry was the whole bug.
 *
 * So these tests encode the requirements the sandbox has to keep satisfying,
 * rather than pinning the file's text.
 */

const ROOT = process.cwd();
const UNIT = join(ROOT, 'packages/jkai-builder/jkai-builder.service');

function unit(): string {
  return readFileSync(UNIT, 'utf8');
}

/** Directive lookup that ignores comments — this file is mostly commentary. */
function directive(name: string): string | null {
  for (const line of unit().split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1).trim();
  }
  return null;
}

function readWritePaths(): string[] {
  return (directive('ReadWritePaths') ?? '').split(/\s+/).filter(Boolean);
}

describe('jkai-builder.service', () => {
  it('exists — deploy-builder.sh copies it verbatim to /etc/systemd/system', () => {
    expect(existsSync(UNIT)).toBe(true);
  });

  it('still sandboxes the home directory', () => {
    // If this ever stops being true the rest of this file is testing nothing,
    // so assert it rather than assume it.
    expect(directive('ProtectHome')).toBe('read-only');
  });

  it('grants write to pi’s config directory', () => {
    // pi >= 0.84 takes a lock directory beside every config file it reads:
    // auth.json.lock, settings.json.lock, trust.json.lock. Under
    // ProtectHome=read-only, without this entry, `pi` cannot start.
    //
    // A grant on a parent counts — ReadWritePaths is a prefix grant — so accept
    // /home/johnk, /home/johnk/.pi, or anything deeper on that path.
    const piConfig = '/home/johnk/.pi';
    const granted = readWritePaths().some(
      (p) => piConfig === p || piConfig.startsWith(`${p}/`) || p.startsWith(`${piConfig}/`),
    );
    expect(
      granted,
      `ReadWritePaths does not cover ${piConfig}. pi cannot start without it — ` +
        `every build fails with "EROFS: read-only file system, mkdir ` +
        `'${piConfig}/agent/trust.json.lock'". Got: ${readWritePaths().join(' ')}`,
    ).toBe(true);
  });

  it('does not make pi’s config directory inaccessible with the other hand', () => {
    // InaccessiblePaths wins over ReadWritePaths, so a future entry that hid
    // /home/johnk wholesale would reintroduce the same outage while this file's
    // ReadWritePaths line still read correctly.
    const inaccessible = (directive('InaccessiblePaths') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.replace(/^-/, ''));
    for (const p of inaccessible) {
      expect(
        '/home/johnk/.pi' === p || '/home/johnk/.pi'.startsWith(`${p}/`),
        `InaccessiblePaths entry ${p} would hide pi's config directory`,
      ).toBe(false);
    }
  });

  it('starts a launcher that exists in the repo and is executable', () => {
    // ExecStart names a path under the deployed checkout. If the file is not in
    // the repo the unit deploys fine and the service never starts.
    const execStart = directive('ExecStart');
    expect(execStart).toBeTruthy();
    const bin = execStart!.split(/\s+/)[0];
    const repoPath = bin.replace('/opt/strange-rambling-svelte/', '');
    expect(
      existsSync(join(ROOT, repoPath)),
      `ExecStart points at ${bin}, which is not tracked at ${repoPath}`,
    ).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(statSync(join(ROOT, repoPath)).mode & 0o111, `${repoPath} is not executable`).toBeGreaterThan(0);
  });
});
