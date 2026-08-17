/**
 * Turning raw gate/command output into a stable error key.
 *
 * This is the hot path's query builder: when a build's gate fails, the
 * diagnostics `orchestrator.ts` has already extracted are mechanically the
 * sharpest possible retrieval key we will ever have, and reducing them to a
 * fingerprint costs a regex rather than an LLM call.
 *
 * Everything here was written against measured output from 25 real sessions
 * (374 MB, 8,647 Bash results), and three findings shaped it:
 *
 * 1. ANSI ESCAPES FRAGMENT EVERYTHING. Vitest colours its FAIL banner, so the
 *    same failure produced several "distinct" signatures depending on which
 *    escape codes happened to be in the slice. 246 distinct signatures collapse
 *    hard once stripped. Strip before matching, always.
 *
 * 2. "found 0 errors" IS A PASS. A naive /\d+ errors/ classifier read
 *    `svelte-check found 0 errors` as a failure, and it was the single most
 *    common "failure" in the first pass — 30 hits, all of them green runs. A
 *    guard that flags everything is exactly as useless as one that flags
 *    nothing, so the zero-cases are asserted in the test file and must stay.
 *
 * 3. COMMAND IDENTITY IS USELESS AS A KEY. Across 25 sessions there was
 *    exactly ONE case of an agent re-running a byte-identical command after a
 *    failure; the command almost always carries a file list or a grep pipe that
 *    changes between runs. So the key is the error CLASS, never the command.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return String(text ?? '').replace(ANSI, '');
}

/** Gate families we can name. Anything else fingerprints as 'cmd'. */
export type GateName = 'svelte-check' | 'vitest' | 'build' | 'lint' | 'typecheck' | 'gate' | 'cmd';

/**
 * Does this output describe a failure?
 *
 * Deliberately ordered: the zero-cases are checked FIRST and return false, so
 * no later pattern can resurrect a green run as a failure.
 */
export function looksFailed(rawText: string): boolean {
  const t = stripAnsi(rawText).slice(0, 40_000);
  if (!t.trim()) return false;

  // --- The zero-cases. See note 2 above; do not reorder below the patterns. ---
  const hasRealCount = /\b[1-9]\d*\s+(errors?|failed|failing|problems?)\b/i.test(t);
  const hasZeroCount =
    /\bfound 0 errors?\b/i.test(t) ||
    /\b0 errors?\b/i.test(t) ||
    /\b0 failed\b/i.test(t) ||
    /\bTests?:\s*0 failed\b/i.test(t);
  if (hasZeroCount && !hasRealCount) return false;

  // An explicitly successful exit beats a stray "error" in prose (a log line
  // reading "no errors found", a file path containing the word).
  if (/\bexit code 0\b/.test(t) && !hasRealCount) return false;

  return (
    /\bexit code\s*[1-9]\d*\b/.test(t) ||
    /(^|\s)FAIL(ED)?\b/.test(t) ||
    /\berror TS\d+\b/.test(t) ||
    /\b\w*Error:\s/.test(t) ||
    /\bTests?:\s*[1-9]\d* failed\b/i.test(t) ||
    /\bfound [1-9]\d* errors?\b/i.test(t) ||
    hasRealCount ||
    /Traceback \(most recent call last\)/.test(t)
  );
}

/** Which gate produced this output, as best we can tell from the command. */
export function gateOf(command: string): GateName {
  const c = String(command ?? '').toLowerCase();
  if (/svelte-check/.test(c)) return 'svelte-check';
  if (/\bvitest\b|\bnpm (run )?test\b|\bjest\b/.test(c)) return 'vitest';
  if (/\btsc\b|gate:check/.test(c)) return 'typecheck';
  if (/vite build|npm run build|gate:build/.test(c)) return 'build';
  if (/eslint|ruff|prettier|gate:font|gate:public/.test(c)) return 'lint';
  if (/npm run gate\b/.test(c)) return 'gate';
  return 'cmd';
}

/**
 * A stable, low-cardinality key for an error class, e.g. `typecheck:TS2345`.
 *
 * Low cardinality is the whole point: the key has to match ACROSS sessions, so
 * anything varying run to run — file paths, line numbers, counts, durations,
 * hex ids, timings — is deliberately excluded. Two different TS2345s on
 * different files share a fingerprint on purpose; the episodes hanging off it
 * carry the specifics.
 */
export function fingerprintOf(rawText: string, command = ''): string | null {
  const t = stripAnsi(rawText);
  if (!t.trim()) return null;
  const gate = gateOf(command);

  // TypeScript diagnostics: the code IS the class. Best key we get.
  const ts = t.match(/error (TS\d+)\b/);
  if (ts) return `${gate === 'cmd' ? 'typecheck' : gate}:${ts[1]}`;

  // Svelte compiler / a11y warnings promoted to errors carry a stable slug.
  const svelte = t.match(/\b(a11y[_-][a-z_]+|svelte\/[a-z-]+)\b/);
  if (svelte) return `svelte-check:${svelte[1].replace(/-/g, '_')}`;

  // Named runtime errors. Take the CLASS, never the message — the message
  // carries identifiers and paths and would explode cardinality.
  const named = t.match(/\b(\w*(?:Error|Exception))\b(?!\s*:\s*$)/);
  if (named && named[1] !== 'Error') return `${gate}:${named[1]}`;

  // Module resolution — the package name is the class and is stable.
  const mod = t.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/);
  if (mod) return `${gate}:missing-module:${mod[1].split('/').slice(0, 2).join('/')}`;

  // A failing test FILE is a usable class when nothing sharper is present.
  const failFile = t.match(/FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)/);
  if (failFile) return `vitest:${failFile[1].split('/').pop()}`;

  const assertion = t.match(/\bAssertionError\b/);
  if (assertion) return `${gate}:AssertionError`;

  if (/\bexit code\s*([1-9]\d*)\b/.test(t)) {
    const code = t.match(/\bexit code\s*([1-9]\d*)\b/)![1];
    return `${gate}:exit-${code}`;
  }
  return null;
}

/**
 * Every fingerprint present in a blob of gate output, most specific first.
 * A gate run reports several failures at once, and the sharpest one is not
 * always the first — so we return the set and let the caller ask for all of
 * them in one query.
 */
export function fingerprintsIn(rawText: string, command = ''): string[] {
  const t = stripAnsi(rawText);
  if (!t.trim()) return [];
  const out = new Set<string>();

  for (const m of t.matchAll(/error (TS\d+)\b/g)) out.add(`typecheck:${m[1]}`);
  for (const m of t.matchAll(/\b(a11y[_-][a-z_]+)\b/g)) out.add(`svelte-check:${m[1].replace(/-/g, '_')}`);
  for (const m of t.matchAll(/Cannot find (?:module|package) ['"]([^'"]+)['"]/g)) {
    out.add(`${gateOf(command)}:missing-module:${m[1].split('/').slice(0, 2).join('/')}`);
  }
  for (const m of t.matchAll(/\b(\w+(?:Error|Exception))\b/g)) {
    if (m[1] !== 'Error') out.add(`${gateOf(command)}:${m[1]}`);
  }

  if (!out.size) {
    const single = fingerprintOf(rawText, command);
    if (single) out.add(single);
  }
  // Bounded: a catastrophic run can name dozens, and a query seeded with all of
  // them is neither fast nor focused.
  return [...out].slice(0, 8);
}
