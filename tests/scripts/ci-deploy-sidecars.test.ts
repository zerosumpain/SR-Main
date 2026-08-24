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
const SCRIPT = join(ROOT, 'scripts/ci-deploy-sidecars.sh');

function manifest(): Array<{ name: string; script: string; unit: string }> {
  const src = readFileSync(SCRIPT, 'utf8');
  const block = src.match(/SIDECARS=\(([\s\S]*?)\n\)/);
  expect(block, 'SIDECARS array not found in ci-deploy-sidecars.sh').not.toBeNull();
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

  it('is wired into the release, or it never runs', () => {
    const release = readFileSync(join(ROOT, 'scripts/ci-release.sh'), 'utf8');
    expect(release).toContain('ci-deploy-sidecars.sh');
  });

  it('exits 0 even on failure, so a sidecar cannot fail the web release', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/exit 0\s*$/);
  });
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
