import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const fixtures: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'source-footprint-'));
  fixtures.push(directory);
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(join(directory, 'src/app.ts'), 'export const answer = 42;\n');
  execFileSync('git', ['init', '-q'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'CI'], { cwd: directory });
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: directory });
  execFileSync('git', ['branch', 'github/master'], { cwd: directory });
  return directory;
}

function check(directory: string) {
  return spawnSync('node', [join(ROOT, 'scripts/check-source-footprint.mjs')], {
    cwd: directory,
    env: { ...process.env, SOURCE_FOOTPRINT_ROOT: directory },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('source footprint gate', () => {
  it('accepts a small maintained source tree', () => {
    const result = check(fixture());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source footprint: ok');
  });

  it('rejects generated package output committed to git', () => {
    const directory = fixture();
    mkdirSync(join(directory, 'packages/worker/dist'), { recursive: true });
    writeFileSync(join(directory, 'packages/worker/dist/start.js'), 'compiled();\n');
    execFileSync('git', ['add', '-f', 'packages/worker/dist/start.js'], { cwd: directory });

    const result = check(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('generated output is tracked');
    expect(result.stderr).toContain('packages/worker/dist/start.js');
  });

  it('rejects oversized new source files', () => {
    const directory = fixture();
    writeFileSync(join(directory, 'src/oversized.ts'), 'export const value = 1;\n'.repeat(1_001));

    const result = check(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('new source file src/oversized.ts has 1001 lines');
  });
});
