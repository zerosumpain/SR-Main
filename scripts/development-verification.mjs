/**
 * Reading a failed isolated verification: who caused it, and what to show.
 *
 * Kept out of the broker so it can be tested — importing the broker starts its
 * HTTP server.
 */

/**
 * Failures the candidate did not cause and cannot fix. Filed as `feature`, they
 * sent the worker off to "repair" a flake it cannot touch, and autopilot counted
 * a round for it. Each pattern is one seen on a real verification run.
 */
const KNOWN_FLAKES = [
  // jsdom's css-color pulls an ESM-only lru-cache through require().
  /Cannot require\(\) ES Module[\s\S]{0,400}lru-cache|lru-cache[\s\S]{0,400}Cannot require\(\) ES Module/,
  /ERR_REQUIRE_ASYNC_MODULE/,
  // The preview database or the DinD volume ran out of disk.
  /ENOSPC|no space left on device|could not write init file/i,
  /Cannot connect to the Docker daemon|OCI runtime (?:create|exec) failed/,
];

/**
 * `infrastructure` for a known flake, otherwise the caller's fallback.
 * @param {unknown} output @param {string} [fallback] @returns {string}
 */
export function failureKindFor(output, fallback = 'feature') {
  return KNOWN_FLAKES.some((pattern) => pattern.test(String(output ?? ''))) ? 'infrastructure' : fallback;
}

/**
 * Colour codes arrive both escaped and BARE — the escape byte is often lost
 * before the log is stored, leaving literal `[31m` behind.
 * @param {string} text
 */
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[0-9;]{1,8}m/g, '');
}

/**
 * The part of a failed step's output worth a model's attention.
 *
 * The last 1,600 characters of a vitest run are usually stderr noise from
 * tests that PASSED — scheduler boot warnings, mocked failures — and the one
 * line naming the failing file sat above it, cut off. So the verdict lines go
 * first, then the tail for context.
 * @param {unknown} output @param {number} [limit] @returns {string}
 */
export function verificationExcerpt(output, limit = 1600) {
  const clean = stripAnsi(String(output ?? ''));
  const verdicts = clean.split('\n')
    .map((/** @type {string} */ line) => line.trimEnd())
    .filter((/** @type {string} */ line) => /^\s*(?:FAIL\b|×|✗|❯ .*\.test\.|Error:|\w*Error:|AssertionError|Test Files\b|Tests\b.*failed|error TS\d+|Error \d+:)/.test(line))
    .filter((/** @type {string} */ line, /** @type {number} */ index, /** @type {string[]} */ all) => all.indexOf(line) === index)
    .join('\n')
    .slice(0, Math.floor(limit * 0.6));
  const tail = clean.slice(-(limit - verdicts.length));
  return verdicts ? `${verdicts}\n…\n${tail}` : tail;
}
