import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * The manifest in `ci-deploy-sidecars.sh` is an allow-list, and this repo has
 * been bitten by allow-lists before: a new entry that names something which does
 * not exist fails at 3am on the VPS, in a script nobody reads, with the release
 * reporting success.
 *
 * So every manifest line is checked against the tree here, at gate time.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/ci-stage-sidecars.sh');

function manifest(): Array<{ name: string; script: string; unit: string }> {
  const src = readFileSync(SCRIPT, 'utf8');
  const block = src.match(/SIDECARS=\(([\s\S]*?)\n\)/);
  expect(block, 'SIDECARS array not found in ci-stage-sidecars.sh').not.toBeNull();
  // Require the exact three-field shape. A loose /"([^"]+)"/ also matches the
  // whitespace BETWEEN two entries, inventing a bogus row — which only shows up
  // once there is more than one sidecar, i.e. exactly when this matters.
  const rows = [...block![1].matchAll(/"([^"|]+)\|([^"|]+)\|([^"|]+)"/g)];
  return rows.map((m) => ({ name: m[1], script: m[2], unit: m[3] }));
}

describe('ci-deploy-sidecars manifest', () => {
  const entries = manifest();

  it('is not empty — an empty manifest silently deploys nothing', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('$name: package directory exists', ({ name }) => {
    expect(existsSync(join(ROOT, 'packages', name))).toBe(true);
  });

  it.each(entries)('$name: npm script "$script" exists', ({ script }) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.scripts)).toContain(script);
  });

  it.each(entries)('$name: unit file "$unit" exists in the package', ({ name, unit }) => {
    expect(existsSync(join(ROOT, 'packages', name, unit))).toBe(true);
  });

  it.each(entries)('$name: unit filename ends .service so the derived unit name is right', ({ unit }) => {
    expect(unit.endsWith('.service')).toBe(true);
  });

  it('does NOT include jkai-builder — it has an apply-when-idle path of its own', () => {
    // Restarting the builder kills the `pi` process of any build in flight, with
    // no resume. ci-stage-builder.sh stages and a watchdog applies when idle.
    expect(entries.map((e) => e.name)).not.toContain('jkai-builder');
  });

  it('the BUILD half runs in prebuild, not release', () => {
    // This is the bug that shipped: the build ran from ci-release.sh, whose job
    // deliberately has no `npm ci`. Every sidecar warned, the script exited 0,
    // and the deploy reported success having changed nothing.
    //
    // The two halves now sit on different MACHINES — prebuild builds on
    // porkserv, release stages on the VPS — so the invariant is checked at its
    // source rather than by which script a job happens to call. Every manifest
    // script must be built in prebuild, and the stage script, which runs where
    // there is no node_modules, must not build at all.
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const start = ci.indexOf('name: Prebuild (porkserv)');
    const end = ci.indexOf('name: Release (VPS)');
    // Assert the markers, so a renamed job fails saying so rather than slicing
    // an empty string and reporting "expected '' to contain ...".
    expect(start, 'prebuild job not found in ci.yml — renamed?').toBeGreaterThan(-1);
    expect(end, 'release job not found in ci.yml — renamed?').toBeGreaterThan(start);

    const prebuild = ci.slice(start, end);
    for (const e of entries) {
      expect(prebuild, `${e.name}: not built in the prebuild job`).toContain(`npm run ${e.script}`);
    }

    // Comment lines are stripped first: the script's header explains the very
    // history this guards, and says `npm run` while doing so.
    const stageCode = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(stageCode, 'the stage script must not build — its job has no node_modules').not.toMatch(/npm run/);

    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    expect(release).not.toContain('ci-stage-sidecars.sh');
  });

  it('the APPLY half runs in the release, or nothing ever restarts', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    expect(release).toContain('ci-apply-sidecars.sh');
  });

  it('the stage script never restarts a service — that is the apply half\'s job', () => {
    const stage = readFileSync(SCRIPT, 'utf8');
    expect(stage).not.toMatch(/systemctl (restart|start)\b/);
  });

  it('the apply script never builds — its job has no node_modules', () => {
    const apply = readFileSync(join(ROOT, 'scripts/ci-apply-sidecars.sh'), 'utf8');
    expect(apply).not.toMatch(/npm run/);
  });

  it.each(['scripts/ci-stage-sidecars.sh', 'scripts/ci-apply-sidecars.sh'])(
    '%s exits 0 even on failure, so a sidecar cannot fail the web release',
    (rel) => {
      expect(readFileSync(join(ROOT, rel), 'utf8')).toMatch(/exit 0\s*$/);
    },
  );
});

describe('the manifest parser itself', () => {
  it('reads exactly the entries present, with no phantom rows', () => {
    const entries = manifest();
    const src = readFileSync(SCRIPT, 'utf8');
    const block = src.match(/SIDECARS=\(([\s\S]*?)\n\)/)![1];
    // One row per non-blank, non-comment line inside the array.
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(entries.length).toBe(lines.length);
    for (const e of entries) {
      expect(e.name).not.toMatch(/\s/);
      expect(e.script).not.toMatch(/\s/);
      expect(e.unit).not.toMatch(/\s/);
    }
  });
});
