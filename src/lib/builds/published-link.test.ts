import { describe, it, expect } from 'vitest';
import { publishedLink, publishedLabel } from './published-link';

// The four shapes below are every distinct value of `published_slug` present in
// production on 2026-08-23, not invented cases.
describe('publishedLink', () => {
  it('links an app build slug into /projects', () => {
    expect(publishedLink('stopwatch')).toEqual({
      href: '/projects/stopwatch/',
      label: 'Live',
      external: false,
    });
    expect(publishedLink('simple-calculator')?.href).toBe('/projects/simple-calculator/');
  });

  it('links a git-target build straight at its pull request', () => {
    const link = publishedLink('https://github.com/zerosumpain/SR-Main/pull/416');
    expect(link).toEqual({
      href: 'https://github.com/zerosumpain/SR-Main/pull/416',
      label: 'Pull request',
      external: true,
    });
  });

  it('never builds /projects/<a full url> — the bug this exists for', () => {
    const link = publishedLink('https://github.com/zerosumpain/SR-Main/pull/416');
    expect(link?.href.startsWith('/projects/')).toBe(false);
  });

  it('returns no link for a bare compare ref rather than inventing a host', () => {
    // `publishViaGit` writes `${baseBranch}...${branch}` with no host, because
    // the repo differs per build. Guessing one would send Forge builds to the
    // wrong repository.
    expect(publishedLink('master...agent/ab2-a15e73d3')).toBeNull();
  });

  it('returns no link for empty, whitespace or missing values', () => {
    expect(publishedLink(null)).toBeNull();
    expect(publishedLink(undefined)).toBeNull();
    expect(publishedLink('')).toBeNull();
    expect(publishedLink('   ')).toBeNull();
  });

  it('rejects a slug with a path separator so it cannot escape /projects', () => {
    expect(publishedLink('../admin')).toBeNull();
    expect(publishedLink('a/b')).toBeNull();
    expect(publishedLink('Stopwatch')).toBeNull();
  });
});

describe('publishedLabel', () => {
  it('keeps the raw value so an unlinkable ref is still readable', () => {
    expect(publishedLabel('master...agent/ab2-a15e73d3')).toBe('master...agent/ab2-a15e73d3');
    expect(publishedLabel('  ')).toBeNull();
    expect(publishedLabel(null)).toBeNull();
  });
});
