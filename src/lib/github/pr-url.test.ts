import { describe, it, expect } from 'vitest';
import { prNumberFromUrl } from './pr';

// `published_slug` holds three shapes (see $lib/builds/published-link); only
// one of them is a pull request on this repo.
describe('prNumberFromUrl', () => {
  it('reads the number from a pull-request url', () => {
    expect(prNumberFromUrl('https://github.com/zerosumpain/SR-Main/pull/416')).toBe(416);
    expect(prNumberFromUrl('  https://github.com/zerosumpain/SR-Main/pull/308  ')).toBe(308);
  });

  it('ignores a branch ref, a project slug and junk', () => {
    expect(prNumberFromUrl('master...agent/ab2-a15e73d3')).toBeNull();
    expect(prNumberFromUrl('stopwatch')).toBeNull();
    expect(prNumberFromUrl(null)).toBeNull();
    expect(prNumberFromUrl('')).toBeNull();
  });

  it('refuses a pull request on a different repository', () => {
    // The Forge publishes against its own repo; reading its file list here
    // would describe the wrong codebase.
    expect(prNumberFromUrl('https://github.com/someone/else/pull/416')).toBeNull();
  });

  it('is not fooled by a url that merely contains the repo name', () => {
    expect(prNumberFromUrl('https://github.com/zerosumpain/SR-Main/issues/414')).toBeNull();
    expect(prNumberFromUrl('https://example.com/zerosumpain/SR-Main/pull/416')).toBeNull();
  });
});
