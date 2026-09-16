import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';

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
  it('leaves an extracted application’s envelopes recoverable through lease expiry during deployment', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    // The excluded lanes used to be the literal `trigger <> 'policy-analysis'`,
    // here and in deploy.sh and twice more in TypeScript. Two more extractions
    // makes that a string four places have to agree on. All of them now come
    // from the generated lane list.
    expect(release).toContain('queue_triggers_clause ./scripts/external-queue-triggers.txt');
    expect(release).toContain("WHERE status='running' $QUEUE_MINE_SQL");
    expect(release).not.toContain("trigger <> 'policy-analysis'");
  });

  it('uses the same structural gate entrypoint locally and in GitHub', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const structural = readFileSync(join(ROOT, 'scripts/gate-structural.sh'), 'utf8');
    const validate = readFileSync(join(ROOT, 'scripts/validate-change.sh'), 'utf8');
    expect(pkg.scripts.gate).toContain('./scripts/gate-structural.sh');
    expect(pkg.scripts['gate:source-footprint']).toBe('node scripts/check-source-footprint.mjs');
    expect(structural).toContain('npm run gate:source-footprint');
    expect(validate).toContain('npm run gate:source-footprint');
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
    expect(workflow).toContain("candidate_certified != 'true'");

    // Promotion moved OUT of prebuild and INTO release. Routing a certified
    // candidate through porkserv was a 241s relay that verified nothing: it
    // downloaded the artifact the PR built, restamped nine lines, and uploaded
    // the same bytes for the VPS to download again.
    expect(job('release')).toContain('ci-promote-candidate.sh');
    expect(job('prebuild')).not.toContain('ci-promote-candidate.sh');
  });

  // Each of these is a way the fast path could ship the wrong bytes or leave
  // production half-deployed, so each is pinned rather than trusted to review.
  it('keeps the two release paths mutually exclusive and fail-closed', () => {
    const release = job('release');

    // prebuild is skipped on the fast path, so `skipped` had to become an
    // accepted result. It is accepted in exactly one state.
    expect(release).toContain("needs.prebuild.result == 'skipped' && needs.level.outputs.candidate_certified == 'true'");
    expect(release).toContain("needs.gate.result == 'success'");
    // always() would make cancelling a no-op on the one job that touches
    // production.
    expect(release).toContain('!cancelled()');

    // The fallback payload is collected only when porkserv actually produced
    // one; otherwise a stale build/ in the reused workspace could be staged.
    expect(release).toMatch(/name: Download the release payload[\s\S]*?if: needs\.prebuild\.result == 'success'/);

    // A rejected candidate cannot be rebuilt here — no node_modules, no build
    // step — so the job must stop rather than stage whatever is lying around.
    expect(release).toContain('Refuse to deploy a rejected candidate');
    expect(release).toContain("steps.promote.outputs.promoted != 'true'");

    // NEVER a file called .env in a workspace on the production box. That name,
    // a few directories from $VPS_DIR, is the first half of the 2026-07-24
    // outage. Only the content is fingerprinted, so the name is free.
    expect(release).toContain('.build-env');
    expect(release).not.toMatch(/}\s*>\s*\.env\b/);
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

  it('keeps the protected production env immutable and isolates the Webframe credential', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    const webframe = readFileSync(join(ROOT, 'scripts/ci-webframe.sh'), 'utf8');

    expect(webframe).toContain('WEBFRAME_ENV_FILE="$VPS_DIR/.webframe.env"');
    expect(webframe).toContain('EnvironmentFile=-%s');
    expect(webframe).toContain('UnsetEnvironment=AUTH_BYPASS');
    expect(webframe).toContain('--env-file "$WEBFRAME_ENV_FILE"');
    expect(webframe).not.toContain('ENV_FILE="$VPS_DIR/.env"');
    expect(webframe).not.toContain('touch "$VPS_DIR/.env"');
    expect(release).not.toMatch(/sed .*AUTH_BYPASS.*\.env/);
  });

  it('ships the npm configuration that produced the production lockfile', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');

    expect(release).toContain('package.json package-lock.json .npmrc');
    expect(release).toContain('npm ci --omit=dev --no-audit --no-fund');
    expect(release).not.toContain('npm ci --omit=dev --silent');
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
  // The artifact is UNTRUSTED input. It is named by a tree hash and produced by
  // a pull_request run, and until 2026-09-16 it was unpacked with `path: .`
  // straight over the checkout root — immediately before the runner executed
  // ./scripts/ci-promote-candidate.sh, a file the archive itself could replace.
  // It now lands in .candidate/ and only an allow-listed set of paths is ever
  // moved out of it.
  function fixture(opts: { stampedEnv?: string; smuggle?: Record<string, string> } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'candidate-promotion-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.candidate/build'), { recursive: true });
    cpSync(join(ROOT, 'scripts/ci-promote-candidate.sh'), join(root, 'scripts/ci-promote-candidate.sh'));
    writeFileSync(join(root, '.gitignore'), '.env\nbuild\npackages/*/dist\n.candidate\n');
    writeFileSync(join(root, 'source.txt'), 'gated source\n');
    writeFileSync(join(root, '.env'), 'PUBLIC_VALUE=production\n');
    writeFileSync(join(root, '.candidate/build/handler.js'), 'export {};\n');
    for (const [rel, body] of Object.entries(opts.smuggle ?? {})) {
      mkdirSync(dirname(join(root, '.candidate', rel)), { recursive: true });
      writeFileSync(join(root, '.candidate', rel), body);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'CI'], { cwd: root });
    execFileSync('git', ['add', '.gitignore', 'source.txt'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
    const envHash = createHash('sha256').update('PUBLIC_VALUE=production\n').digest('hex');
    writeFileSync(
      join(root, '.candidate/build/.deploy-sha'),
      `sha=old\nshort=old\ntree=${tree}\nbuild_env_sha256=${opts.stampedEnv ?? envHash}\nbuilt_at=2026-09-01T20:00:00Z\n`,
    );
    return root;
  }

  const promote = (root: string, output: string) =>
    execFileSync('bash', ['scripts/ci-promote-candidate.sh'], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });

  it('restamps an exact tree and environment for the merge commit', () => {
    const root = fixture();
    try {
      const output = join(root, 'output');
      promote(root, output);
      const stamp = readFileSync(join(root, 'build/.deploy-sha'), 'utf8');
      expect(stamp).toContain(`sha=${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`);
      expect(stamp).toContain('via=github-actions-promoted');
      expect(readFileSync(output, 'utf8')).toContain('promoted=true');
      // Moved out of staging, not copied: nothing should be left behind to be
      // picked up by a later step.
      expect(existsSync(join(root, '.candidate'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a fresh build when the environment differs', () => {
    const root = fixture({ stampedEnv: 'wrong-environment-hash' });
    try {
      const output = join(root, 'output');
      promote(root, output);
      expect(readFileSync(output, 'utf8')).toContain('promoted=false');
      expect(existsSync(join(root, 'build/handler.js'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The attack this shape exists to stop. An artifact carrying its own copy of
  // the promotion script used to overwrite the real one before it ran.
  it('refuses a candidate carrying anything outside the allow-list', () => {
    const root = fixture({
      smuggle: { 'scripts/ci-promote-candidate.sh': '#!/bin/bash\necho pwned\n' },
    });
    try {
      const output = join(root, 'output');
      promote(root, output);
      expect(readFileSync(output, 'utf8')).toContain('promoted=false');
      expect(existsSync(join(root, 'build/handler.js'))).toBe(false);
      // The real script is untouched.
      expect(readFileSync(join(root, 'scripts/ci-promote-candidate.sh'), 'utf8')).not.toContain('pwned');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A symlink inside build/ would satisfy a path allow-list while still
  // pointing anywhere on the runner. The artifact is only ever regular files.
  it('refuses a candidate containing a symlink', () => {
    const root = fixture();
    try {
      symlinkSync('/etc/passwd', join(root, '.candidate/build/sneaky.js'));
      const output = join(root, 'output');
      promote(root, output);
      expect(readFileSync(output, 'utf8')).toContain('promoted=false');
      expect(existsSync(join(root, 'build/handler.js'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
