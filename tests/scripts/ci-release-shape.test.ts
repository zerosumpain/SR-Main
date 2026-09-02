import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';

/**
 * The build moved to porkserv and the release job stayed on the VPS, so the two
 * halves now run on different MACHINES. Only one of them has node_modules.
 *
 * That distinction cost a failed deploy: ci-prebuild.sh runs
 * check-built-extract.mjs, which imports the BUILT server chunks — and those
 * import from node_modules. Left in the release job it died on "Cannot find
 * package 'marked'", after the gate was green and the merge had landed.
 *
 * These assert the split at gate time instead.
 */

const ROOT = process.cwd();
const ci = () => readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

function job(name: string): string {
  const src = ci();
  const start = src.indexOf(`  ${name}:\n`);
  expect(start, `job ${name} not found in ci.yml — renamed?`).toBeGreaterThan(-1);
  // Up to the next top-level job key (two-space indent), or end of file.
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the prebuild/release split across two machines', () => {
  it('uses the same structural gate entrypoint locally and in GitHub', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.gate).toContain('./scripts/gate-structural.sh');
    expect(job('level')).toContain('./scripts/gate-structural.sh');
  });

  it('anything importing the built bundle runs in prebuild, which has node_modules', () => {
    expect(job('prebuild')).toContain('ci-prebuild.sh');
    expect(job('release')).not.toContain('ci-prebuild.sh');
  });

  it('the VPS-side staging script builds and imports nothing', () => {
    const stage = readFileSync(join(ROOT, 'scripts/ci-stage-release.sh'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    // `node ...` and `npm ...` both need a node_modules this job does not have.
    expect(stage).not.toMatch(/^\s*(node|npm|npx)\s/m);
  });

  it('release stages through ci-stage-release.sh', () => {
    expect(job('release')).toContain('ci-stage-release.sh');
  });

  it('the artifact carries hidden files, or the deploy stamp is dropped', () => {
    // build/.deploy-sha is a dotfile. upload-artifact excludes hidden files by
    // default and only warns, so without this the stamp vanishes and
    // ci-stage-release.sh refuses to ship.
    expect(job('prebuild')).toContain('include-hidden-files: true');
  });

  it('ci-prebuild.sh no longer writes to the VPS — it runs on a different box', () => {
    const prebuild = readFileSync(join(ROOT, 'scripts/ci-prebuild.sh'), 'utf8');
    expect(prebuild).not.toContain('VPS_DIR');
  });

  it('reuses only a tree-addressed candidate from a successful PR gate', () => {
    const workflow = ci();
    expect(job('build')).toContain('candidate-${{ steps.source.outputs.tree }}');
    expect(job('build')).toContain('ci-prebuild.sh');
    expect(job('build')).not.toContain('SR_GATE_STUB_ADAPTER');
    expect(job('level')).toContain("gate?.conclusion !== 'success'");
    expect(job('level')).toContain('candidate-${tree}');
    expect(job('prebuild')).toContain('ci-promote-candidate.sh');
    expect(workflow).toContain("candidate_certified != 'true'");
  });

  it('verifies both the commit and tree before staging on the VPS', () => {
    const stage = readFileSync(join(ROOT, 'scripts/ci-stage-release.sh'), 'utf8');
    expect(stage).toContain('artifact was built from');
    expect(stage).toContain('artifact tree is');
  });

  it('cancels superseded PR runs but never master releases', () => {
    expect(ci()).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('proves the exact public commit and automatically restores the previous release', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    expect(release).toContain('/api/version?expected=');
    expect(release).toContain('wait_for_public_release "$SHA"');
    expect(release).toContain('rollback_web_release');
    expect(release).toContain('wait_for_public_release "$PREV_SHA"');
    expect(release.indexOf('wait_for_public_release "$SHA"')).toBeLessThan(
      release.indexOf('./scripts/ci-apply-sidecars.sh'),
    );
  });
});

describe('the local fast path', () => {
  it('scopes local tests to origin/master and supplies the Svelte public env', () => {
    const scoped = readFileSync(join(ROOT, 'scripts/gate-test-scoped.sh'), 'utf8');
    const validate = readFileSync(join(ROOT, 'scripts/validate-change.sh'), 'utf8');
    expect(scoped).toContain('BASE=origin/master');
    expect(validate).toContain('PUBLIC_VAPID_PUBLIC_KEY');
    expect(validate).toContain('gate-test-scoped.sh "$BASE"');
    expect(validate).not.toContain('gate:build');
  });
});

describe('candidate promotion', () => {
  function fixture(stampedEnv?: string) {
    const root = mkdtempSync(join(tmpdir(), 'candidate-promotion-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'build'));
    cpSync(join(ROOT, 'scripts/ci-promote-candidate.sh'), join(root, 'scripts/ci-promote-candidate.sh'));
    writeFileSync(join(root, '.gitignore'), '.env\nbuild\npackages/*/dist\n');
    writeFileSync(join(root, 'source.txt'), 'gated source\n');
    writeFileSync(join(root, '.env'), 'PUBLIC_VALUE=production\n');
    writeFileSync(join(root, 'build/handler.js'), 'export {};\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'CI'], { cwd: root });
    execFileSync('git', ['add', '.gitignore', 'source.txt'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
    const envHash = createHash('sha256').update('PUBLIC_VALUE=production\n').digest('hex');
    writeFileSync(
      join(root, 'build/.deploy-sha'),
      `sha=old\nshort=old\ntree=${tree}\nbuild_env_sha256=${stampedEnv ?? envHash}\nbuilt_at=2026-09-01T20:00:00Z\n`,
    );
    return root;
  }

  it('restamps an exact tree and environment for the merge commit', () => {
    const root = fixture();
    try {
      const output = join(root, 'output');
      execFileSync('bash', ['scripts/ci-promote-candidate.sh'], {
        cwd: root,
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      const stamp = readFileSync(join(root, 'build/.deploy-sha'), 'utf8');
      expect(stamp).toContain(`sha=${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`);
      expect(stamp).toContain('via=github-actions-promoted');
      expect(readFileSync(output, 'utf8')).toContain('promoted=true');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a fresh build when the environment differs', () => {
    const root = fixture('wrong-environment-hash');
    try {
      const output = join(root, 'output');
      execFileSync('bash', ['scripts/ci-promote-candidate.sh'], {
        cwd: root,
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      expect(readFileSync(output, 'utf8')).toContain('promoted=false');
      expect(() => readFileSync(join(root, 'build/handler.js'))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
