import { describe, it, expect } from 'vitest';
import { sourceHref, linksToItem } from './provenance';

describe('sourceHref', () => {
  it('links out where the URL identifies the actual item', () => {
    expect(sourceHref('n1', { sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/abc' })).toBe(
      'https://mail.google.com/mail/u/0/#inbox/abc',
    );
    expect(sourceHref('n1', { sourceUrl: '/deepdive/11f1accd' })).toBe('/deepdive/11f1accd');
  });

  it('falls back to the note for a URL that only names a section', () => {
    // 38 file notes carry the bare string '/drive' — the root, with no file id
    // and no deep-link parameter. Following it lands you in a file browser with
    // no idea which document was meant.
    for (const url of ['/drive', '/drive/', '/jkai', '/', '/deepdive']) {
      expect(sourceHref('n1', { sourceUrl: url })).toBe('/jkai/intel/notes/n1');
    }
  });

  it('falls back to the note when there is no URL at all', () => {
    // chat notes carry only a refId, web notes carry neither.
    expect(sourceHref('n1', { refId: 'c9' })).toBe('/jkai/intel/notes/n1');
    expect(sourceHref('n1', null)).toBe('/jkai/intel/notes/n1');
    expect(sourceHref('n1', { sourceUrl: '   ' })).toBe('/jkai/intel/notes/n1');
  });
});

describe('linksToItem', () => {
  it('distinguishes the item from the note extracted out of it', () => {
    expect(linksToItem('https://mail.google.com/mail/u/0/#inbox/abc')).toBe(true);
    expect(linksToItem('/deepdive/11f1accd')).toBe(true);
    expect(linksToItem('/jkai/intel/notes/n1')).toBe(false);
  });
});
