/**
 * A green /jkai/develop verification must predict a green CI.
 *
 * The broker's verifyRuntime and the CI gate are two lists of the same checks,
 * and they had already drifted: CI ran the authored-runner smoke, the database
 * contracts and ci-prebuild.sh's built-bundle check, and the broker ran none of
 * them, so a candidate could pass isolated verification and go red on its PR.
 * This reads both files and fails when CI gains a gate script the broker does
 * not run, unless the broker's comment names why it cannot.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
const broker = readFileSync(resolve('scripts/development-workspace-broker.mjs'), 'utf8');
const verifyRuntime = broker.slice(broker.indexOf('async function verifyRuntime'), broker.indexOf('async function assertVerificationControls'));

/** The jobs whose verdict gates a merge — not the release that follows it. */
function gateJobScripts(): string[] {
  const scripts = new Set<string>();
  for (const job of ['level', 'typecheck', 'test', 'build']) {
    const start = ci.search(new RegExp(`^  ${job}:$`, 'm'));
    expect(start, `ci.yml has no ${job} job`).toBeGreaterThan(-1);
    const rest = ci.slice(start + 1);
    const end = rest.search(/^  [a-z][\w-]*:$/m);
    for (const match of rest.slice(0, end === -1 ? undefined : end).matchAll(/run: \.\/scripts\/([\w.-]+)/g)) scripts.add(match[1]);
  }
  return [...scripts].sort();
}

/**
 * CI scripts the broker runs by their parts rather than by name, with the part
 * that proves it. Each is explained in the comment above verifyRuntime.
 */
const RUN_BY_PARTS: Record<string, string> = {
  'gate-check.sh': "'svelte-check'",
  'gate-test-shard.sh': "'vitest', 'run'",
};

describe('isolated verification and CI run the same gate', () => {
  it('runs every gate script CI runs, by name or by its parts', () => {
    const scripts = gateJobScripts();
    // A parse that found nothing would pass everything below.
    expect(scripts).toEqual(expect.arrayContaining(['check-authored-runner.sh', 'ci-prebuild.sh', 'gate-db-contracts.sh', 'gate-structural.sh']));
    const missing = scripts.filter((script) => !verifyRuntime.includes(`./scripts/${script}`) && !(RUN_BY_PARTS[script] && verifyRuntime.includes(RUN_BY_PARTS[script])));
    expect(missing).toEqual([]);
  });

  it('shares the database contract list through one script', () => {
    expect(ci).toContain('run: ./scripts/gate-db-contracts.sh');
    expect(ci).not.toMatch(/vitest run[^\n]*\.integration\.test\.ts/);
  });

  it('refuses a candidate that edits any script verification executes', () => {
    const controls = broker.slice(broker.indexOf('async function assertVerificationControls'), broker.indexOf('async function accept'));
    const pattern = new RegExp(controls.match(/const control = changed\.find\(\(file\) => (\/.+\/)\.test\(file\)\)/)![1].slice(1, -1));
    for (const file of ['gate-db-contracts.sh', 'gate-structural.sh', 'ci-prebuild.sh', 'check-built-extract.mjs', 'check-authored-runner.sh']) expect(pattern.test(`scripts/${file}`), file).toBe(true);
  });

  it('accept gates inside its trial preview instead of building twice', () => {
    const accept = broker.slice(broker.indexOf('async function accept'), broker.indexOf('let lane'));
    expect(accept).toContain('verifyAs: id');
    expect(accept).not.toContain('await verifyRuntime(');
    expect(broker).toContain('options.verify || options.verifyAs) await verifyRuntime(');
  });

  it('fingerprints the scripts verification now executes', () => {
    const fingerprint = broker.slice(broker.indexOf('async function runtimeFingerprint'), broker.indexOf('async function allocate'));
    for (const file of ['gate-db-contracts.sh', 'ci-prebuild.sh', 'check-built-extract.mjs', 'check-authored-runner.sh']) expect(fingerprint).toContain(`scripts/${file}`);
  });
});
