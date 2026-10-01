import { describe, it, expect } from 'vitest';
import { acceptanceVerdict, failureExcerpt, fixEpisodeFrom, pendingFailureFrom, queuePendingFailure, verdictWins, MAX_PENDING } from './development-episodes';
import type { PendingFailure } from '$lib/constants/development';

const RED = 'a'.repeat(40);
const GREEN = 'b'.repeat(40);
const TS_FAILURE = 'The gate failed in `gate:check`.\nsrc/lib/x.ts:3:1 - error TS2345: Argument of type string is not assignable';

function parked(over: Partial<PendingFailure> = {}): PendingFailure {
  return { source: 'verification', revision: RED, fingerprint: 'typecheck:TS2345', excerpt: TS_FAILURE, at: '2026-10-01T10:00:00.000Z', ...over };
}

describe('pendingFailureFrom keys a failure on its error class', () => {
  it('reads the TypeScript code, the sharpest key there is', () => {
    const f = pendingFailureFrom({ source: 'verification', revision: RED, diagnostics: TS_FAILURE, at: 'now' });
    expect(f).toMatchObject({ source: 'verification', revision: RED, fingerprint: 'typecheck:TS2345', at: 'now' });
  });

  it('drops a failure with no class — nothing could ever find its episode', () => {
    // A broker timeout dressed as a feature failure fingerprints to nothing.
    expect(pendingFailureFrom({ source: 'verification', revision: RED, diagnostics: 'Workspace operation failed' })).toBeNull();
  });

  it('drops a failure with no revision — there is no diff to take from it', () => {
    expect(pendingFailureFrom({ source: 'ci', revision: null, diagnostics: TS_FAILURE })).toBeNull();
  });

  it('carries the pull request for a CI failure', () => {
    expect(pendingFailureFrom({ source: 'ci', revision: RED, diagnostics: TS_FAILURE, prNumber: 812 })?.prNumber).toBe(812);
  });
});

describe('queuePendingFailure keeps the start of a streak', () => {
  it('does not replace the first red with a repeat of it', () => {
    const first = parked();
    const queue = queuePendingFailure([first], parked({ revision: 'c'.repeat(40), at: 'later' }));
    // Same array back: the caller reads that as "already parked" and skips the write.
    expect(queue).toEqual([first]);
  });

  it('parks a different error class, or the same class from the other source, alongside', () => {
    const queue = queuePendingFailure(queuePendingFailure([parked()], parked({ fingerprint: 'gate:TypeError' })), parked({ source: 'ci' }));
    expect(queue.map((p) => `${p.source}/${p.fingerprint}`)).toEqual(['verification/typecheck:TS2345', 'verification/gate:TypeError', 'ci/typecheck:TS2345']);
  });

  it('is bounded', () => {
    let queue: PendingFailure[] = [];
    for (let i = 0; i < MAX_PENDING + 3; i++) queue = queuePendingFailure(queue, parked({ fingerprint: `gate:E${i}Error` }));
    expect(queue).toHaveLength(MAX_PENDING);
  });
});

describe('fixEpisodeFrom: red then green, with edits in between', () => {
  const input = { buildId: 'build-1', failure: parked(), passRevision: GREEN, passEvidence: 'Isolated checks passed.', changedFiles: ['src/lib/x.ts', 'src/lib/x.ts', 'src/lib/y.ts'], exact: true };

  it('is a verified episode keyed on the failing revision and error class, linked to its files and gate', () => {
    const e = fixEpisodeFrom(input)!;
    expect(e).toMatchObject({ sourceKind: 'development', sourceId: 'build-1', verdict: 'verified', fingerprint: 'typecheck:TS2345', gate: 'typecheck',
      title: 'typecheck: typecheck:TS2345', filesTouched: ['src/lib/x.ts', 'src/lib/y.ts'], verification: 'Isolated checks passed.' });
    expect(e.dedupeKey).toBe(`development-fix:build-1:verification:${RED}:typecheck:TS2345`);
    expect(e.nodes).toEqual(['src/lib/x.ts', 'src/lib/y.ts', 'gate:typecheck']);
    expect(e.problem).toContain('error TS2345');
    expect(e.resolution).toMatch(/^Fixed by changing 2 file\(s\) between candidate aaaaaaaaaaaa and bbbbbbbbbbbb/);
  });

  it('is the same key however often the green is observed', () => {
    expect(fixEpisodeFrom({ ...input, passAt: new Date(1) })!.dedupeKey).toBe(fixEpisodeFrom({ ...input, passAt: new Date(2) })!.dedupeKey);
  });

  it('proves nothing when the same revision went green — a flake or a re-run', () => {
    expect(fixEpisodeFrom({ ...input, passRevision: RED })).toBeNull();
  });

  it('proves nothing when no file changed', () => {
    expect(fixEpisodeFrom({ ...input, changedFiles: [] })).toBeNull();
  });

  it('says so when it only had the change set, not the per-revision diff', () => {
    expect(fixEpisodeFrom({ ...input, exact: false })!.resolution).toContain('whole change set, not only the fix');
  });

  it('names the pull request a CI failure came from', () => {
    const e = fixEpisodeFrom({ ...input, failure: parked({ source: 'ci', prNumber: 812, fingerprint: 'gate:gate:check-failed' }) })!;
    expect(e.prNumber).toBe(812);
    expect(e.problem).toMatch(/^CI on pull request #812 failed/);
    expect(e.gate).toBe('gate');
  });
});

describe('acceptanceVerdict: acceptance is local, production is proof', () => {
  it.each([
    ['unverified', 'deployed', 'verified'],
    ['repaired', 'deployed', 'verified'],
    ['verified', 'deployed', null],
    ['unverified', 'ci_failed', 'repaired'],
    ['unverified', 'closed', 'abandoned'],
    // Autopilot closes the red pull request itself: that is the repair
    // starting, and must not turn `repaired` into `abandoned`.
    ['repaired', 'closed', null],
    ['verified', 'ci_failed', null],
  ] as const)('%s + %s -> %s', (current, event, expected) => {
    expect(acceptanceVerdict(current, event)).toBe(expected);
  });
});

describe('failureExcerpt: one failure, one stored text, whichever path read it', () => {
  it('reads String(error) on the live path and the log line on the backfill the same', () => {
    const message = 'tests failed in isolated verification; full output retained in /var/lib/x.log. Error: Requires a loopback test database';
    const live = failureExcerpt(`Error: ${message}`);
    const logged = failureExcerpt(`Preview/check failure: ${message}. Fix this before expanding the feature. The last successful preview is retained.`);
    expect(live).toBe(logged);
    expect(pendingFailureFrom({ source: 'verification', revision: RED, diagnostics: `Error: ${message}`, at: 'x' }))
      .toEqual(pendingFailureFrom({ source: 'verification', revision: RED, diagnostics: `Preview/check failure: ${message}. Fix this before expanding the feature.`, at: 'x' }));
  });
});

describe('verdictWins: an upsert never lowers a verdict', () => {
  it.each([
    ['unverified', 'landed', true],
    ['unverified', 'abandoned', true],
    ['landed', 'verified', true],
    ['repaired', 'verified', true],
    ['verified', 'landed', false],
    // What a live writer learned outranks what the backfill can see, even
    // though VERDICT_WEIGHT ranks landed above both.
    ['repaired', 'landed', false],
    ['abandoned', 'landed', false],
    ['landed', 'abandoned', false],
    ['verified', 'verified', false],
  ] as const)('%s <- %s: %s', (current, incoming, expected) => {
    expect(verdictWins(current, incoming)).toBe(expected);
  });
});
