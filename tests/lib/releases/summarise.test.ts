import { describe, it, expect } from 'vitest';
import {
  buildSummaryPrompt,
  fallbackSummary,
  kindFromSubject,
  normaliseSummary,
} from '$lib/releases/summarise';
import type { CommitFact, FileFact } from '$lib/releases/types';

const commits: CommitFact[] = [
  {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    short: 'aaaaaaaa',
    author: 'John Kelly',
    date: '2026-07-26T12:00:00Z',
    subject: 'feat(releases): add the version log (#41)',
    body: 'Phase 2 (public changelog) is deferred.',
    pr: 41,
  },
  {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    short: 'bbbbbbbb',
    author: 'John Kelly',
    date: '2026-07-26T12:05:00Z',
    subject: 'fix(releases): guard the empty range',
    body: '',
    pr: null,
  },
];

const files: FileFact[] = [
  { path: 'src/lib/releases/summarise.ts', status: 'A', insertions: 300, deletions: 0 },
  { path: 'src/routes/admin/ops/releases/+page.svelte', status: 'A', insertions: 420, deletions: 0 },
];

const evidence = { commits, files };

describe('buildSummaryPrompt', () => {
  const prompt = buildSummaryPrompt({
    version: '2026.07.26.1',
    shortSha: 'aaaaaaaa',
    deployedAt: new Date('2026-07-26T12:10:00Z'),
    commits,
    files,
    stats: { commits: 2, files: 2, insertions: 720, deletions: 0, prs: [41] },
  } as never);

  it('includes every commit subject and the PR number', () => {
    expect(prompt).toContain('feat(releases): add the version log (#41)');
    expect(prompt).toContain('fix(releases): guard the empty range');
    expect(prompt).toContain('PR #41');
  });

  it('carries commit bodies through — that is where deferred work is stated', () => {
    expect(prompt).toContain('Phase 2 (public changelog) is deferred.');
  });

  it('groups files by area with their churn', () => {
    expect(prompt).toContain('src/lib/releases/summarise.ts (A +300/-0)');
    expect(prompt).toContain('src/routes/admin/');
  });
});

describe('normaliseSummary', () => {
  it('keeps a well-formed item intact', () => {
    const result = normaliseSummary(
      {
        title: 'Release log',
        summary: 'Adds the version log.',
        items: [
          {
            kind: 'feature',
            impact: 'user-facing',
            title: 'Version log',
            summary: 'Records every deploy.',
            includes: ['admin page', 'git backfill'],
            excludes: ['no public changelog'],
            surfaces: ['/admin/ops/releases'],
            files: ['src/lib/releases/summarise.ts'],
            commits: ['aaaaaaaa'],
            confidence: 'high',
          },
        ],
      },
      evidence,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: 'feature',
      impact: 'user-facing',
      includes: ['admin page', 'git backfill'],
      excludes: ['no public changelog'],
      files: ['src/lib/releases/summarise.ts'],
      commits: ['aaaaaaaa'],
    });
  });

  it('drops invented file paths and commit shas', () => {
    // The failure mode that would make the whole log untrustworthy: a summary
    // that cites evidence which does not exist in the release.
    const result = normaliseSummary(
      {
        title: 't',
        summary: 's',
        items: [
          {
            kind: 'feature',
            title: 'Thing',
            summary: '',
            files: ['src/lib/releases/summarise.ts', 'src/lib/totally/invented.ts'],
            commits: ['aaaaaaaa', 'deadbeef'],
          },
        ],
      },
      evidence,
    );
    expect(result.items[0].files).toEqual(['src/lib/releases/summarise.ts']);
    expect(result.items[0].commits).toEqual(['aaaaaaaa']);
  });

  it('coerces unknown enum values to safe defaults', () => {
    const result = normaliseSummary(
      { items: [{ kind: 'banana', impact: 'cosmic', confidence: 'certain', title: 'X' }] },
      evidence,
    );
    expect(result.items[0]).toMatchObject({ kind: 'improvement', impact: 'internal', confidence: 'medium' });
  });

  it('drops items with no title and survives junk input', () => {
    expect(normaliseSummary({ items: [{ summary: 'no title' }, null, 7] }, evidence).items).toEqual([]);
    expect(normaliseSummary(null, evidence).items).toEqual([]);
    expect(normaliseSummary('nonsense', evidence).items).toEqual([]);
  });

  it('falls back to the first commit subject when the model omits a title', () => {
    expect(normaliseSummary({}, evidence).title).toBe('feat(releases): add the version log (#41)');
  });

  it('strips non-string entries from includes/excludes', () => {
    const result = normaliseSummary(
      { items: [{ title: 'X', includes: ['real', 42, null, '  '], excludes: 'not an array' }] },
      evidence,
    );
    expect(result.items[0].includes).toEqual(['real']);
    expect(result.items[0].excludes).toEqual([]);
  });
});

describe('kindFromSubject', () => {
  it('reads conventional-commit prefixes', () => {
    expect(kindFromSubject('feat(x): thing')).toBe('feature');
    expect(kindFromSubject('fix(x): thing')).toBe('fix');
    expect(kindFromSubject('perf: faster')).toBe('improvement');
    expect(kindFromSubject('ci: pin node')).toBe('infra');
    expect(kindFromSubject('docs: readme')).toBe('content');
    expect(kindFromSubject('chore: tidy')).toBe('chore');
  });
  it('defaults to improvement for unprefixed subjects', () => {
    expect(kindFromSubject('Give reasoning models enough max_tokens')).toBe('improvement');
  });
});

describe('fallbackSummary', () => {
  it('produces one low-confidence item per commit with no invented detail', () => {
    const result = fallbackSummary(evidence);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ kind: 'feature', confidence: 'low', includes: [], excludes: [] });
    expect(result.items[1].kind).toBe('fix');
  });
});
