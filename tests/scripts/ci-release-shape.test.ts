import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
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
});
