/**
 * The PR extractor is the join key between a Claude session and the releases it
 * produced, so a false positive attaches a session to work it never did.
 *
 * Two narrowings are load-bearing, and both were found by measuring rather than
 * by reasoning:
 *
 *  - The `(#123)` suffix a squashed commit subject carries was tried first and
 *    dropped. It matches every subject a session merely READ in a `git log`, so
 *    one `git log -20` credited a session with twenty releases. Measured: it
 *    gave 8 PRs to a session that opened 4, and 31 to one that opened 2.
 *  - The URL must be anchored to the ORIGIN. Without that the extractor matched
 *    its own documentation — a memory note reading "the URL form
 *    (/SR-Main/pull/123)" credited that session with PR #123. Measured across
 *    all 180 transcripts, anchoring drops exactly that one false positive and
 *    keeps all 589 real links across the same 139 sessions.
 *
 * `gh` always prints the full https://github.com/owner/repo/pull/N; prose about
 * pull requests usually writes the short form. That is the whole distinction.
 *
 * The behaviour is asserted against a copy of the pattern, and a grep canary
 * ties that copy to the real one — the parser is plain `.mjs` and importing it
 * from a typed test drags 76 type errors into `svelte-check`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(process.cwd(), 'scripts/claude-changelog/parse-transcript.mjs');

/** Must stay identical to the one in parse-transcript.mjs — see the canary. */
const PATTERN = String.raw`/github\.com\/[A-Za-z0-9_.-]+\/(?:SR-Main|strange_rambling[a-z_]*)\/pull\/(\d{1,6})/gi`;

function extract(text: string): number[] {
  const re = /github\.com\/[A-Za-z0-9_.-]+\/(?:SR-Main|strange_rambling[a-z_]*)\/pull\/(\d{1,6})/gi;
  const found = new Set<number>();
  for (const m of text.matchAll(re)) found.add(Number(m[1]));
  return [...found].filter((n) => n > 0 && n < 100_000).sort((a, b) => a - b);
}

describe('pull-request extraction', () => {
  it('uses the same pattern the parser does', () => {
    // The canary. If the parser's regex is changed, this test must be changed
    // with it — which is the moment to re-read why it is narrow.
    expect(readFileSync(SOURCE, 'utf8')).toContain(PATTERN.slice(1, -3));
  });

  it('takes the full URL gh prints', () => {
    expect(extract('https://github.com/zerosumpain/SR-Main/pull/896')).toEqual([896]);
  });

  it('takes several, deduplicated and sorted', () => {
    expect(
      extract(
        'https://github.com/zerosumpain/SR-Main/pull/900 ' +
          'https://github.com/zerosumpain/SR-Main/pull/896 ' +
          'https://github.com/zerosumpain/SR-Main/pull/900',
      ),
    ).toEqual([896, 900]);
  });

  it('IGNORES a bare path, which is how prose and documentation write it', () => {
    // This exact string, in a note describing the extractor, is what put a PR
    // the session never touched into its list.
    expect(extract('The extractor matches ONLY the URL form (`/SR-Main/pull/123`).')).toEqual([]);
  });

  it('IGNORES the (#N) suffix a squashed commit subject carries', () => {
    expect(extract('fix: anchor the gate rsync exclude (#882)\nchore: prune geo (#881)')).toEqual([]);
  });

  it('IGNORES a bare #N', () => {
    expect(extract('see #44 and #895 for context')).toEqual([]);
  });

  it('returns nothing for a session that opened no pull request', () => {
    // Not a failed join — a session that opened no PR. It must link to nothing
    // rather than guess.
    expect(extract('just reading the code today, nothing shipped')).toEqual([]);
  });
});

/** Must stay identical to extractPullRequestRefs in parse-transcript.mjs — see its canary. */
const REFS_PATTERN = String.raw`/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d{1,6})/g`;

function extractRefs(text: string): string[] {
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d{1,6})/g;
  const found = new Set<string>();
  for (const m of text.matchAll(re)) {
    const n = Number(m[3]);
    if (n > 0 && n < 100_000) found.add(`${m[1]}/${m[2]}#${n}`.toLowerCase());
  }
  return [...found].sort();
}

describe('pull-request refs in any repository', () => {
  it('uses the same pattern the parser does', () => {
    expect(readFileSync(SOURCE, 'utf8')).toContain(REFS_PATTERN.slice(1, -2));
  });

  it('keeps the repository, so one number never means two pull requests', () => {
    expect(extractRefs(
      'https://github.com/zerosumpain/SR-Drive/pull/67 https://github.com/zerosumpain/SR-Main/pull/67 ' +
        'https://github.com/zerosumpain/casebook/pull/12',
    )).toEqual(['zerosumpain/casebook#12', 'zerosumpain/sr-drive#67', 'zerosumpain/sr-main#67']);
  });

  it('still ignores the short form prose uses', () => {
    expect(extractRefs('see /SR-Drive/pull/67 and #12')).toEqual([]);
  });
});
