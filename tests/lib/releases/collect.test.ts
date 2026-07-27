import { describe, it, expect } from 'vitest';
import {
  clusterCommits,
  isReleaseBoundary,
  parseNumstat,
  parseNameStatus,
  parsePrNumber,
  contentHash,
  DEFAULT_GAP_SECONDS,
} from '../../../scripts/release-log/collect.mjs';

type C = { sha: string; short: string; ts: number; parents: string[]; subject: string; pr: number | null };

/** Build a first-parent commit at `minutes` past an arbitrary epoch. */
function commit(id: string, minutes: number, subject = `chore: ${id}`, parents = ['p' + id]): C {
  return {
    sha: id.padEnd(40, '0'),
    short: id,
    ts: 1_700_000_000 + minutes * 60,
    parents,
    subject,
    pr: parsePrNumber(subject),
  };
}

describe('parsePrNumber', () => {
  it('reads a squash-merge suffix', () => {
    expect(parsePrNumber('feat(jkai): live tok/s meter in the sidebar footer (#25)')).toBe(25);
  });
  it('reads a merge-commit subject', () => {
    expect(parsePrNumber('Merge pull request #7 from zerosumpain/agent/thing')).toBe(7);
  });
  it('ignores an issue reference that is not a trailing squash marker', () => {
    expect(parsePrNumber('fix: address (#12) in the body text properly')).toBeNull();
    expect(parsePrNumber('chore: bump deps')).toBeNull();
  });
});

describe('isReleaseBoundary', () => {
  it('treats a PR squash as its own release', () => {
    expect(isReleaseBoundary(commit('a1', 0, 'feat: thing (#12)'))).toBe(true);
  });
  it('treats a true merge commit as its own release', () => {
    expect(isReleaseBoundary({ ...commit('a2', 0), parents: ['p1', 'p2'] })).toBe(true);
  });
  it('leaves ordinary commits clusterable', () => {
    expect(isReleaseBoundary(commit('a3', 0))).toBe(false);
  });
});

describe('clusterCommits', () => {
  it('groups a run of commits made in one sitting into one release', () => {
    const clusters = clusterCommits([commit('a', 0), commit('b', 5), commit('c', 12)], DEFAULT_GAP_SECONDS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((c: C) => c.short)).toEqual(['a', 'b', 'c']);
  });

  it('splits on a gap longer than the threshold', () => {
    const clusters = clusterCommits([commit('a', 0), commit('b', 5), commit('c', 200)], DEFAULT_GAP_SECONDS);
    expect(clusters).toHaveLength(2);
    expect(clusters[1].map((c: C) => c.short)).toEqual(['c']);
  });

  it('never clusters a PR squash with its neighbours, however close in time', () => {
    // The CI era deploys one PR at a time — #34 landing 5 minutes after #33 is
    // two deploys, not one, and merging them would misattribute both.
    const clusters = clusterCommits(
      [commit('a', 0, 'feat: one (#33)'), commit('b', 5, 'fix: two (#34)'), commit('c', 7, 'feat: three (#35)')],
      DEFAULT_GAP_SECONDS,
    );
    expect(clusters).toHaveLength(3);
  });

  it('does not let a PR squash absorb the ordinary commits that follow it', () => {
    const clusters = clusterCommits(
      [commit('a', 0, 'feat: one (#33)'), commit('b', 2), commit('c', 4)],
      DEFAULT_GAP_SECONDS,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].map((c: C) => c.short)).toEqual(['a']);
    expect(clusters[1].map((c: C) => c.short)).toEqual(['b', 'c']);
  });

  it('returns nothing for an empty history', () => {
    expect(clusterCommits([], DEFAULT_GAP_SECONDS)).toEqual([]);
  });

  it('honours a custom gap', () => {
    const commits = [commit('a', 0), commit('b', 20)];
    expect(clusterCommits(commits, 60 * 60)).toHaveLength(1);
    expect(clusterCommits(commits, 10 * 60)).toHaveLength(2);
  });
});

describe('parseNumstat', () => {
  it('parses counts and keeps paths containing spaces', () => {
    const files = parseNumstat('12\t3\tsrc/lib/a.ts\n0\t7\tsrc/some file.md\n');
    expect(files).toEqual([
      { path: 'src/lib/a.ts', status: 'M', insertions: 12, deletions: 3 },
      { path: 'src/some file.md', status: 'M', insertions: 0, deletions: 7 },
    ]);
  });

  it('scores binary files (reported as -/-) as zero rather than NaN', () => {
    const [file] = parseNumstat('-\t-\tstatic/img.png\n');
    expect(file).toEqual({ path: 'static/img.png', status: 'M', insertions: 0, deletions: 0 });
  });

  it('ignores blank lines', () => {
    expect(parseNumstat('\n\n')).toEqual([]);
  });
});

describe('parseNameStatus', () => {
  it('maps paths to their status letter', () => {
    const map = parseNameStatus('A\tsrc/new.ts\nD\tsrc/old.ts\nM\tsrc/edit.ts\n');
    expect(map.get('src/new.ts')).toBe('A');
    expect(map.get('src/old.ts')).toBe('D');
    expect(map.get('src/edit.ts')).toBe('M');
  });
});

describe('contentHash', () => {
  it('is stable for identical facts and differs when a file changes', () => {
    const commits = [{ sha: 'abc' }];
    const files = [{ path: 'a.ts', insertions: 1, deletions: 0 }];
    expect(contentHash(commits, files)).toBe(contentHash(commits, files));
    expect(contentHash(commits, [{ path: 'a.ts', insertions: 2, deletions: 0 }])).not.toBe(
      contentHash(commits, files),
    );
  });
});
