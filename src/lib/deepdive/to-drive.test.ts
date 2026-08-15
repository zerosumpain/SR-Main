import { describe, it, expect } from 'vitest';
import {
  slug,
  researchFolder,
  driveFileStem,
  driveFileName,
  stemOf,
  classifyDownload,
  pageMarkdown,
} from './to-drive';

describe('slug', () => {
  it('keeps a topic readable as a folder name', () => {
    expect(slug('Darlington running events')).toBe('darlington-running-events');
  });

  it('folds accents rather than dropping the letter', () => {
    expect(slug('Château Lafite')).toBe('chateau-lafite');
  });

  it('never ends in a dash, even when the cut lands on one', () => {
    expect(slug('abcdefghij klmno', 11)).toBe('abcdefghij');
  });

  it('has something to fall back on when nothing survives', () => {
    expect(slug('   ///   ')).toBe('untitled');
    expect(slug('日本語')).toBe('untitled');
  });
});

describe('paths', () => {
  const source = { url: 'https://example.org/papers/one.pdf', title: 'A Study of Things' };

  it('puts every run under research/<topic>', () => {
    expect(researchFolder('Hany Shoukry')).toBe('research/hany-shoukry');
  });

  it('is stable for the same URL, so a second save is recognised as one', () => {
    expect(driveFileStem('research/x', source)).toBe(driveFileStem('research/x', source));
  });

  it('separates two sources that share a title', () => {
    const a = driveFileStem('research/x', { url: 'https://a.test/p', title: 'Untitled' });
    const b = driveFileStem('research/x', { url: 'https://b.test/p', title: 'Untitled' });
    expect(a).not.toBe(b);
  });

  it('falls back to the domain, then the URL, for an untitled source', () => {
    expect(driveFileStem('research/x', { url: 'https://a.test/p', domain: 'a.test' })).toContain('a-test');
  });

  it('round-trips through stemOf whatever extension the download turned out to be', () => {
    const stem = driveFileStem('research/x', source);
    expect(stemOf(driveFileName('research/x', source, 'pdf'))).toBe(stem);
    expect(stemOf(driveFileName('research/x', source, 'md'))).toBe(stem);
  });

  it('does not mistake a dot in a folder name for an extension', () => {
    expect(stemOf('research/a.b/file')).toBe('research/a.b/file');
  });
});

describe('classifyDownload', () => {
  it('keeps a declared PDF as a PDF', () => {
    expect(classifyDownload('https://x.test/a', 'application/pdf')).toMatchObject({
      ext: 'pdf',
      isDocument: true,
    });
  });

  it('tolerates a charset parameter on the content type', () => {
    expect(classifyDownload('https://x.test/a.csv', 'text/csv; charset=utf-8').ext).toBe('csv');
  });

  it('believes the server over the URL — a .pdf served as HTML is an interstitial', () => {
    expect(classifyDownload('https://x.test/paper.pdf', 'text/html')).toMatchObject({
      ext: 'md',
      isDocument: false,
    });
  });

  it('falls back to the extension when the server says nothing useful', () => {
    expect(classifyDownload('https://x.test/paper.pdf', 'application/octet-stream').ext).toBe('pdf');
    expect(classifyDownload('https://x.test/paper.docx', null).ext).toBe('docx');
  });

  it('treats anything unrecognised as a page to be saved as markdown', () => {
    expect(classifyDownload('https://x.test/some/article', 'text/html')).toMatchObject({
      mime: 'text/markdown',
      ext: 'md',
      isDocument: false,
    });
  });
});

describe('pageMarkdown', () => {
  const saved = new Date('2026-08-15T09:00:00Z');

  it('carries the provenance a citation needs', () => {
    const md = pageMarkdown(
      { url: 'https://x.test/a', title: 'A Piece', domain: 'x.test' },
      'Darlington running events',
      'Body text.',
      saved,
    );
    expect(md).toContain('# A Piece');
    expect(md).toContain('- Source: https://x.test/a');
    expect(md).toContain('- Publisher: x.test');
    expect(md).toContain('- Gathered for: Darlington running events');
    expect(md).toContain('- Saved: 2026-08-15');
    expect(md).toContain('Body text.');
  });

  it('omits the publisher line rather than printing an empty one', () => {
    const md = pageMarkdown({ url: 'https://x.test/a' }, 'topic', 'text', saved);
    expect(md).not.toContain('Publisher');
    expect(md).toContain('# https://x.test/a');
  });
});
