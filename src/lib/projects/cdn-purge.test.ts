import { describe, it, expect } from 'vitest';
import { buildPurgeUrls } from './cdn-purge';

describe('buildPurgeUrls', () => {
  it('maps relative bundle files to absolute prod URLs', () => {
    expect(buildPurgeUrls('terminal-descent', ['index.html', 'assets/index-abc.js'])).toEqual([
      'https://strangeramblings.com/projects/terminal-descent/',
      'https://strangeramblings.com/projects/terminal-descent/index.html',
      'https://strangeramblings.com/projects/terminal-descent/assets/index-abc.js',
    ]);
  });

  it('always includes the directory-root URL even with no files', () => {
    expect(buildPurgeUrls('archetype', [])).toEqual([
      'https://strangeramblings.com/projects/archetype/',
    ]);
  });

  it('normalises backslashes and leading slashes, and de-dupes', () => {
    expect(buildPurgeUrls('x', ['assets\\a.js', '/assets/a.js'])).toEqual([
      'https://strangeramblings.com/projects/x/',
      'https://strangeramblings.com/projects/x/assets/a.js',
    ]);
  });
});
