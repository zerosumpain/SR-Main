import { describe, it, expect } from 'vitest';
import {
  fileAnchors,
  researchAnchors,
  linkifyCitations,
  type CiteTarget,
} from './citation-linkify';

describe('fileAnchors', () => {
  it('offers full path, basename, and basename-without-extension, longest first', () => {
    expect(fileAnchors('drive/photos/portrait.jpg')).toEqual([
      'drive/photos/portrait.jpg',
      'portrait.jpg',
      'portrait',
    ]);
  });

  it('drops anchors shorter than the minimum length', () => {
    // basename-without-extension "a" (1 char) is too short to be a safe anchor;
    // the full path and basename survive.
    expect(fileAnchors('x/a.md')).toEqual(['x/a.md', 'a.md']);
  });
});

describe('researchAnchors', () => {
  it('prefers title, then topic, then domain, plus a leading-phrase prefix', () => {
    const anchors = researchAnchors({
      sourceTitle: 'Anti-bot detection in 2026',
      domain: 'arxiv.org',
      sessionTopic: 'Stealth scraping techniques in 2026',
    });
    // Longest-first ordering, and the leading phrase of the longest label present.
    expect(anchors).toContain('Anti-bot detection in 2026');
    expect(anchors).toContain('Stealth scraping techniques in 2026');
    expect(anchors).toContain('arxiv.org');
    expect(anchors).toContain('Anti-bot detection'); // leading phrase of the title
    // Sorted by length descending.
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i - 1].length).toBeGreaterThanOrEqual(anchors[i].length);
    }
  });

  it('handles a null title/domain gracefully', () => {
    const anchors = researchAnchors({
      sourceTitle: null,
      domain: null,
      sessionTopic: 'Whoop strain formula deep dive',
    });
    expect(anchors).toContain('Whoop strain formula deep dive');
  });
});

const fileTarget = (idx: number, source: string): CiteTarget => ({
  kind: 'file',
  idx,
  anchors: fileAnchors(source),
});

describe('linkifyCitations', () => {
  it('wraps a bare-mention filename in a citation link', () => {
    const { html, matched } = linkifyCitations(
      '<p>Found it in portrait.jpg — a man in a blue shirt.</p>',
      [fileTarget(0, 'jkai/portrait.jpg')],
    );
    expect(html).toContain(
      '<a class="cite-link" role="button" tabindex="0" data-cite-kind="file" data-cite-idx="0">portrait.jpg</a>',
    );
    expect(matched.has('file:0')).toBe(true);
  });

  it('links a filename that the model wrote inside a code span', () => {
    const { html } = linkifyCitations(
      '<p>See <code>jkai/portrait.jpg</code> for the match.</p>',
      [fileTarget(0, 'jkai/portrait.jpg')],
    );
    // The <code> element is preserved; the text inside becomes a link.
    expect(html).toContain('<code>');
    expect(html).toContain('data-cite-idx="0">jkai/portrait.jpg</a>');
  });

  it('never links inside an existing anchor (no clobbering real links)', () => {
    const input = '<p><a href="/x">portrait.jpg</a> is here.</p>';
    const { html, matched } = linkifyCitations(input, [fileTarget(0, 'jkai/portrait.jpg')]);
    expect(html).toBe(input);
    expect(matched.size).toBe(0);
  });

  it('links each source at most once and reports matches', () => {
    const { html, matched } = linkifyCitations(
      '<p>report.pdf mentions X. report.pdf also mentions Y.</p>',
      [fileTarget(3, 'reports/report.pdf')],
    );
    const count = (html.match(/cite-link/g) || []).length;
    expect(count).toBe(1);
    expect(matched.has('file:3')).toBe(true);
  });

  it('links two distinct sources in one sentence', () => {
    const { html, matched } = linkifyCitations(
      '<p>Both notes.md and budget.xlsx cover it.</p>',
      [fileTarget(0, 'notes.md'), fileTarget(1, 'budget.xlsx')],
    );
    expect(matched.has('file:0')).toBe(true);
    expect(matched.has('file:1')).toBe(true);
    expect((html.match(/cite-link/g) || []).length).toBe(2);
  });

  it('respects word boundaries (report does not match reporting)', () => {
    const { html, matched } = linkifyCitations(
      '<p>The reporting pipeline is fine.</p>',
      [{ kind: 'file', idx: 0, anchors: ['report'] }],
    );
    expect(html).not.toContain('cite-link');
    expect(matched.size).toBe(0);
  });

  it('links a research source by its title', () => {
    const target: CiteTarget = {
      kind: 'research',
      idx: 2,
      anchors: researchAnchors({
        sourceTitle: 'Stealth scraping techniques',
        domain: 'example.com',
        sessionTopic: 'Stealth scraping techniques in 2026',
      }),
    };
    const { html, matched } = linkifyCitations(
      '<p>From your Stealth scraping techniques research, canvas fingerprinting dominates.</p>',
      [target],
    );
    expect(html).toContain('data-cite-kind="research" data-cite-idx="2"');
    expect(matched.has('research:2')).toBe(true);
  });

  it('is a no-op with no targets or empty html', () => {
    expect(linkifyCitations('<p>hi</p>', []).html).toBe('<p>hi</p>');
    expect(linkifyCitations('', [fileTarget(0, 'a/b.md')]).html).toBe('');
  });

  it('leaves an unmatched source out of the matched set', () => {
    const { matched } = linkifyCitations('<p>Nothing named here.</p>', [
      fileTarget(0, 'secret/ledger.xlsx'),
    ]);
    expect(matched.size).toBe(0);
  });
});
