import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function check(ubuntu: boolean, fail = false) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-install-'));
  try {
    const source = join(dir, 'ubuntu.sources'); const log = join(dir, 'calls');
    if (ubuntu) writeFileSync(source, '# synthetic source path; no network');
    const script = readFileSync('scripts/check-authored-runner.sh', 'utf8').replaceAll('/etc/apt/sources.list.d/ubuntu.sources', source);
    // Force the missing-package branch; all privileged/package/sandbox commands
    // are disposable fakes, so this test neither installs nor weakens isolation.
    writeFileSync(join(dir, 'check.sh'), script.replace('set -euo pipefail', 'set -euo pipefail\ncommand() { if [[ "$*" == "-v bwrap" ]]; then return 1; fi; builtin command "$@"; }'));
    for (const [name, body] of Object.entries({ sudo: '#!/bin/bash\nprintf "%s\\n" "$*" >> "$RUNNER_TEST_LOG"\nexit "${RUNNER_TEST_EXIT:-0}"\n', bwrap: '#!/bin/bash\nprintf "sandbox %s\\n" "$*" >> "$RUNNER_TEST_LOG"\n' })) { const p = join(dir, name); writeFileSync(p, body); chmodSync(p, 0o755); }
    const result = spawnSync('bash', [join(dir, 'check.sh')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEST_LOG: log, RUNNER_TEST_EXIT: fail ? '100' : '0' }, encoding: 'utf8' });
    return { status: result.status, calls: readFileSync(log, 'utf8'), source };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
it('uses only the Ubuntu source for sandbox packages and still executes the isolation smoke check', () => {
  const r = check(true); expect(r.status).toBe(0);
  expect(r.calls).toContain(`-o Dir::Etc::sourcelist=${r.source} -o Dir::Etc::sourceparts=- update -qq`);
  expect(r.calls).toContain('install -y --no-install-recommends bubblewrap'); expect(r.calls).toContain('sandbox --unshare-all');
});
it('keeps default package sources on other layouts and stops when verified package refresh fails', () => {
  const r = check(false); expect(r.status).toBe(0); expect(r.calls).toContain('apt-get update -qq'); expect(r.calls).not.toContain('Dir::Etc');
  const failed = check(true, true); expect(failed.status).toBe(100); expect(failed.calls).not.toContain('sandbox');
});
