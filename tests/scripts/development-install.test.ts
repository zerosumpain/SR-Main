import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/install-development-dependencies.sh');
function run(failure: string, alwaysFail = false) {
  const root = mkdtempSync(join(tmpdir(), 'development-install-'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/npm'), `#!/bin/bash
printf '%s\\n' "$*" >> calls
if [ "$1" = cache ]; then exit 0; fi
if [ ! -f tried ] || ${alwaysFail ? 'true' : 'false'}; then
  touch tried
  echo '${failure}' >&2
  exit 17
fi
`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [script], { cwd: root, encoding: 'utf8', env: { PATH: `${root}/bin:${process.env.PATH}` } });
    return { status: result.status, calls: readFileSync(join(root, 'calls'), 'utf8').trim().split('\n') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
it('clears only npm cache and retries a disk-exhausted install once', () => {
  expect(run('ENOSPC: no space left on device')).toEqual({ status: 0, calls: ['ci --no-audit --no-fund', 'cache clean --force', 'ci --no-audit --no-fund'] });
});
it('does not hide an unrelated install failure or clear its cache', () => {
  expect(run('package lifecycle failed')).toEqual({ status: 17, calls: ['ci --no-audit --no-fund'] });
});
it('fails after one retry when cache cleanup is insufficient', () => {
  expect(run('ENOSPC', true)).toEqual({ status: 17, calls: ['ci --no-audit --no-fund', 'cache clean --force', 'ci --no-audit --no-fund'] });
});
