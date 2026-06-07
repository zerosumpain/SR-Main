import { describe, it, expect } from 'vitest';
import { buildPurgeUrls } from './cdn-purge';

describe('buildPurgeUrls', () => {
  it('maps relative bundle files to absolute prod URLs', () => {
    expect(buildPurgeUrls('whitehall', ['index.html', 'assets/index-abc.js'])).toEqual([
      'https://strangeramblings.com/projects/whitehall/',
      'https://strangeramblings.com/projects/whitehall/index.html',
      'https://strangeramblings.com/projects/whitehall/assets/index-abc.js',
    ]);
  });

  it('always includes the directory-root URL even with no files', () => {
    expect(buildPurgeUrls('brass-and-rails', [])).toEqual([
      'https://strangeramblings.com/projects/brass-and-rails/',
    ]);
  });

  it('normalises backslashes and leading slashes, and de-dupes', () => {
    expect(buildPurgeUrls('x', ['assets\\a.js', '/assets/a.js'])).toEqual([
      'https://strangeramblings.com/projects/x/',
      'https://strangeramblings.com/projects/x/assets/a.js',
    ]);
  });
});
