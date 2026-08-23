import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The production SvelteKit app is a systemd service running as `johnk`, who is
 * in the `docker` and `sudo` groups. With JKAI_BUILDS_HOSTMODE=1 on the VPS,
 * the build lane in `sandbox.ts` runs commands on the host shell — which means
 * reach to the Docker socket, and from there to root.
 *
 * That trade is accepted for agent-authored BUILD code. It must never be
 * inherited by a call site that executes code or paths supplied by someone
 * else. Those belong on the contained lane (`execInContainer`,
 * `writeFileInContainer`, `ensureContainerRunning`, `getContainerStatus`),
 * which is always `docker exec` whatever the env flag says.
 *
 * This test is the guard rail: it fails if an untrusted call site reaches for
 * a build-lane primitive.
 */

const ROOT = join(process.cwd(), 'src');

/** Call sites that run code or paths they did not author. */
const UNTRUSTED_CALL_SITES = [
  'lib/workflows/nodes/code-execute.ts',
  'routes/api/agent/sandbox/exec/+server.ts',
  'routes/api/scraper/profiles/+server.ts',
  'lib/workflows/scraper/runner.ts',
  'lib/workflows/scraper/interactive.ts',
  'lib/workflows/scraper/agent-harness.ts',
];

/** Primitives that honour JKAI_BUILDS_HOSTMODE and may hit the host shell. */
const BUILD_LANE_PRIMITIVES = [
  'execInSandbox',
  'execInSandboxChecked',
  'execBuildCommand',
  'writeFileInSandbox',
  'writeFileInSandboxChunked',
  'ensureSandboxRunning',
  'getSandboxStatus',
];

describe('sandbox contained lane', () => {
  for (const rel of UNTRUSTED_CALL_SITES) {
    it(`${rel} uses only the contained lane`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const found = BUILD_LANE_PRIMITIVES.filter((name) =>
        new RegExp(`\\b${name}\\b`).test(src),
      );
      expect(
        found,
        `${rel} references build-lane primitive(s) ${found.join(', ')}. ` +
          'Untrusted code must use execInContainer / writeFileInContainer / ' +
          'ensureContainerRunning / getContainerStatus, which never touch the host shell.',
      ).toEqual([]);
    });
  }

  it('the contained lane never branches on BUILD_HOST_MODE', () => {
    const src = readFileSync(join(ROOT, 'lib/jkai/sandbox.ts'), 'utf8');
    // Slice each contained-lane function body and assert the flag is absent.
    for (const fn of [
      'export async function execInContainer(',
      'export async function writeFileInContainer(',
      'export async function ensureContainerRunning(',
      'export async function getContainerStatus(',
    ]) {
      const start = src.indexOf(fn);
      expect(start, `${fn} not found in sandbox.ts`).toBeGreaterThan(-1);
      const next = src.indexOf('\nexport ', start + fn.length);
      const raw = src.slice(start, next === -1 ? undefined : next);
      // Assert on code, not prose: the slice runs to the next export, so it
      // picks up that function's doc comment, which may legitimately name the
      // flag. Strip comments before looking.
      const body = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(
        body.includes('BUILD_HOST_MODE'),
        `${fn} branches on BUILD_HOST_MODE — the contained lane must always use docker exec.`,
      ).toBe(false);
    }
  });
});
