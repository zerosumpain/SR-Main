import { describe, it, expect } from 'vitest';
import {
  blockerLessons, extractBuildHistory, failingTests, gateResults, outcomeEpisodeFrom, pullRequestRef, relatedBySnapshot,
  type HistoryBuild, type HistoryEvent, type HistoryIteration, type HistoryLog,
} from './build-history';
import type { StructuralSnapshot } from './snapshot';

/*
 * Fixtures are cut down from real production rows (2026-10-01), keeping the
 * shapes that matter: `{ lang, code, exitCode }` actions, the orchestrator's
 * exact log prefixes, and the `cycle_progress` event that carries a develop
 * failure's candidate and kind.
 */
const F3 = 'f3a6c096-70f9-4ac6-818f-9411b5134cd3';
const CAND_A = '16ca7ff9'.padEnd(40, '0');
const CAND_B = 'fe4b2e60'.padEnd(40, '1');

const FEED_CHECKS_FAILURE = `Preview/check failure: tests failed in isolated verification; full output retained in /var/lib/development-broker/${F3}-gate-tests.log. ] Boot failed: Cannot access '__vite_ssr_import_7__' before initialization

stderr | tests/lib/workflows/site-tools/visualise-registry.test.ts
[scheduler] Boot failed: Cannot access '__vite_ssr_import_7__' before initialization

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/home/presence/feed-checks.test.ts > feed checks against test PostgreSQL
Error: Requires a loopback test database
 ❯ src/lib/home/presence/feed-checks.test.ts:19:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

. Fix this before expanding the feature. The last successful preview is retained.`;

const t = (minute: number) => new Date(Date.UTC(2026, 8, 27, 14, minute)).toISOString();
const iteration = (buildId: string, number: number, minute: number, edits: string[] = []): HistoryIteration => ({
  id: `${buildId.slice(0, 8)}-it${number}`, buildId, number, createdAt: t(minute),
  actions: edits.map(code => ({ code, lang: 'edit', stderr: '', stdout: `Successfully replaced 1 block(s) in ${code}.`, exitCode: 0 })),
});
const log = (buildId: string, it: HistoryIteration | null, minute: number, content: string, type = 'error'): HistoryLog =>
  ({ buildId, iterationId: it?.id ?? null, type, content, createdAt: t(minute) });
const cycle = (buildId: string, id: number, minute: number, candidate: string, failureKind: string): HistoryEvent =>
  ({ buildId, id, kind: 'cycle_progress', createdAt: t(minute), detail: { candidate, cycle: { failureKind, failure: 'tests failed in isolated verification' } } });
const build = (id: string, over: Partial<HistoryBuild> = {}): HistoryBuild =>
  ({ id, title: 'A feature', prompt: 'Build a jokes page', status: 'completed', outcome: null, publishedSlug: null, createdAt: t(0), delivery: null, ...over });

/** f3a6c096: every candidate failed on a test the feature never touched. */
function feedChecksRun() {
  const its = [iteration(F3, 3, 10, ['src/routes/jokes/+page.svelte']), iteration(F3, 4, 13), iteration(F3, 5, 16, ['src/lib/nav/site-nav.ts']),
    iteration(F3, 6, 27), iteration(F3, 7, 34)];
  const logs = [log(F3, its[0], 12, FEED_CHECKS_FAILURE), log(F3, its[1], 13, 'Preview/check failure: Executor operation deadline reached; saved work is retained.. Fix this before expanding the feature.'),
    log(F3, its[2], 25, FEED_CHECKS_FAILURE), log(F3, its[3], 31, FEED_CHECKS_FAILURE), log(F3, its[4], 39, FEED_CHECKS_FAILURE)];
  const events = [cycle(F3, 1, 12, CAND_A, 'feature'), cycle(F3, 2, 13, CAND_A, 'deadline'), cycle(F3, 3, 25, CAND_B, 'feature'),
    cycle(F3, 4, 31, CAND_B, 'feature'), cycle(F3, 5, 39, CAND_B, 'feature')];
  return { its, logs, events };
}

describe('gateResults reads both lanes as the orchestrator wrote them', () => {
  it('takes only FEATURE failures from isolated verification, with the candidate from the cycle event', () => {
    const { its, logs, events } = feedChecksRun();
    const results = gateResults(its, logs, events);
    // The deadline failure is the broker's, not the code's.
    expect(results.map(r => [r.kind, r.source, r.revision])).toEqual([
      ['fail', 'verification', CAND_A], ['fail', 'verification', CAND_B], ['fail', 'verification', CAND_B], ['fail', 'verification', CAND_B]]);
    expect(results[0].text).not.toMatch(/Fix this before expanding/);
    expect(results[0].text).toContain('Requires a loopback test database');
  });

  it('reads change-request FAIL/PASS lines against their iteration, and a candidate_verified event as a pass', () => {
    const id = 'cr-build';
    const its = [iteration(id, 1, 0), iteration(id, 2, 5)];
    const results = gateResults(its, [log(id, its[0], 4, 'FAIL Tests: 0/1 passed (1 failed)\nerror TS2345'), log(id, its[1], 9, 'PASS Tests: 1/1 passed (154s)', 'system')],
      [{ buildId: id, id: 9, kind: 'candidate_verified', createdAt: t(10), detail: { candidate: CAND_B } }]);
    expect(results.map(r => [r.kind, r.source, r.iteration])).toEqual([['fail', 'gate', 0], ['pass', 'gate', 1], ['pass', 'verification', 1]]);
  });
});

describe('extractBuildHistory on the f3a6c096 run', () => {
  const { its, logs, events } = feedChecksRun();
  const units = extractBuildHistory({ builds: [build(F3, { status: 'paused' })], iterations: its, logs, events, pullRequests: new Map() });

  it('writes no fail→fix episode: nothing ever went green', () => {
    expect(units.episodes).toEqual([]);
    expect(units.counts.gateResults).toBe(4);
  });

  it('states the wall as one lesson, cited on the test, quoting what it threw', () => {
    expect(units.lessons).toHaveLength(1);
    const [lesson] = units.lessons;
    expect(lesson.slug).toBe('build-blocker:src/lib/home/presence/feed-checks.test.ts');
    expect(lesson.citedPaths).toEqual(['src/lib/home/presence/feed-checks.test.ts']);
    expect(lesson.body).toContain('Error: Requires a loopback test database');
    expect(lesson.body).toContain('failed to load or set up');
    expect(lesson.originRef).toBe(`/jkai/develop/${F3}`);
  });

  it('is deterministic, so a re-run upserts the same rows', () => {
    const again = extractBuildHistory({ builds: [build(F3, { status: 'paused' })], iterations: its, logs, events, pullRequests: new Map() });
    expect(again.lessons.map(l => [l.slug, l.body])).toEqual(units.lessons.map(l => [l.slug, l.body]));
  });
});

describe('fail→fix from a change request', () => {
  const id = 'fcd48932-a687-4adb-8f73-da1ba634033b';
  const its = [iteration(id, 1, 0, ['src/a.ts']), iteration(id, 2, 5, ['src/b.ts', 'src/c.ts']), iteration(id, 3, 10, ['src/c.ts'])];
  const fail = log(id, its[0], 4, 'FAIL Tests: 0/1 passed (1 failed)\nThe gate failed in `gate:check`.\nsrc/b.ts:3:1 - error TS2345: Argument of type');

  it('credits every file edited after the red run up to the green one', () => {
    const units = extractBuildHistory({ builds: [build(id)], iterations: its, events: [], pullRequests: new Map(),
      logs: [fail, log(id, its[1], 9, 'FAIL Tests: 0/1 passed (1 failed)\nerror TS2345'), log(id, its[2], 14, 'PASS Tests: 1/1 passed (466s)', 'system')] });
    expect(units.episodes).toHaveLength(1);
    expect(units.episodes[0]).toMatchObject({ fingerprint: 'typecheck:TS2345', gate: 'typecheck', verdict: 'verified', filesTouched: ['src/b.ts', 'src/c.ts'],
      dedupeKey: `development-fix:${id}:gate:${its[0].id}:typecheck:TS2345` });
    expect(units.episodes[0].resolution).toMatch(/after the failing gate run/);
  });

  it('writes nothing when the green run followed no edits', () => {
    const quiet = [iteration(id, 1, 0, ['src/a.ts']), iteration(id, 2, 5)];
    const units = extractBuildHistory({ builds: [build(id)], iterations: quiet, events: [], pullRequests: new Map(),
      logs: [log(id, quiet[0], 4, fail.content), log(id, quiet[1], 9, 'PASS Tests: 1/1 passed', 'system')] });
    expect(units.episodes).toEqual([]);
  });
});

describe('outcome episodes: merged is landed, serving is verified, closed is nothing', () => {
  it('finds the pull request in every form a build recorded it', () => {
    expect(pullRequestRef({ publishedSlug: 'https://github.com/zerosumpain/SR-Main/pull/292', delivery: null })).toEqual({ number: 292 });
    expect(pullRequestRef({ publishedSlug: 'master...agent/ab2-15288c4c', delivery: null })).toEqual({ branch: 'agent/ab2-15288c4c' });
    expect(pullRequestRef({ publishedSlug: null, delivery: { release: { prNumber: 9 } } })).toEqual({ number: 9 });
    expect(pullRequestRef({ publishedSlug: null, delivery: null })).toBeNull();
  });

  const fact = { number: 292, merged: true, deployed: true, mergeSha: 'c39b8e3fc29a'.padEnd(40, '0'), mergedAt: t(20), files: ['src/x.ts'] };

  it('keys a change request on its build and pull request', () => {
    const e = outcomeEpisodeFrom(build('cr'), fact)!;
    expect(e).toMatchObject({ dedupeKey: 'change-request:cr:pr-292', verdict: 'verified', prNumber: 292, fingerprint: null, gate: null, filesTouched: ['src/x.ts'] });
    expect(outcomeEpisodeFrom(build('cr'), { ...fact, deployed: false })!.verdict).toBe('landed');
    expect(outcomeEpisodeFrom(build('cr'), { ...fact, merged: false })).toBeNull();
  });

  it('keys a develop feature exactly as its acceptance episode, so the two are one row', () => {
    const e = outcomeEpisodeFrom(build('dev', { delivery: { candidate: CAND_A, release: { revision: CAND_B, prNumber: 292 } } }), fact)!;
    expect(e.dedupeKey).toBe(`development:dev:${CAND_B}`);
  });
});

describe('blockerLessons does not mistake a build breaking a test for a wall', () => {
  const failure = (buildId: string, revision: string, minute: number) => ({ buildId, revision, at: t(minute),
    text: 'FAIL Tests: 0/1 passed\n FAIL  src/lib/jkai/grounding/authored.test.ts > runs composition in isolation\nAssertionError: expected { success: false } to deeply equal { success: true }\n' });
  const three = (buildId: string) => [failure(buildId, 'r1', 1), failure(buildId, 'r2', 2), failure(buildId, 'r2', 3)];

  it('needs a suite failure or a second build: one build failing an assertion three times is its own problem', () => {
    expect(blockerLessons(three('b1'), new Map([['b1', ['src/routes/rome/+page.svelte']]]))).toEqual([]);
    const lessons = blockerLessons([...three('b1'), ...three('b2')], new Map([['b1', ['src/routes/rome/+page.svelte']], ['b2', ['src/lib/travel/rome.ts']]]));
    expect(lessons.map(l => l.slug)).toEqual(['build-blocker:src/lib/jkai/grounding/authored.test.ts']);
    expect(lessons[0].body).toContain('across 2 build(s)');
  });

  it('declines when the build edited the test, or the module it is named after', () => {
    const builds = [...three('b1'), ...three('b2')];
    expect(blockerLessons(builds, new Map([['b1', ['src/lib/jkai/grounding/authored.test.ts']], ['b2', ['src/lib/jkai/grounding/authored.ts']]]))).toEqual([]);
  });

  it('declines when the import graph says the build reached it', () => {
    const snapshot = { files: ['src/lib/jkai/grounding/authored.test.ts', 'src/lib/sandbox/run.ts'],
      edges: [{ source: 'src/lib/jkai/grounding/authored.test.ts', target: 'src/lib/sandbox/run.ts', kind: 'imports' }], routes: [], dependencies: [] } as unknown as StructuralSnapshot;
    const edits = new Map([['b1', ['src/lib/sandbox/run.ts']], ['b2', ['src/lib/sandbox/run.ts']]]);
    expect(blockerLessons([...three('b1'), ...three('b2')], edits, relatedBySnapshot(snapshot))).toEqual([]);
  });
});

describe('failingTests', () => {
  it('reads every file in a run of back-to-back failures, and which ones never loaded', () => {
    const text = ' FAIL  src/a.test.ts > one\nAssertionError: expected 1 to be 2\n FAIL  src/b.test.ts [ src/b.test.ts ]\nError: No such built-in module: node:\n';
    expect(failingTests(text)).toEqual([
      { path: 'src/a.test.ts', suite: false, error: 'AssertionError: expected 1 to be 2' },
      { path: 'src/b.test.ts', suite: true, error: 'Error: No such built-in module: node:' },
    ]);
  });
});
