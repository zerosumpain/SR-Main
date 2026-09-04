import { describe, it, expect } from 'vitest';
import {
  nextReferenceNumber,
  parseReferences,
  referenceMarker,
  renderReferences,
  splitReferences,
  stripReferences,
  withReferences,
} from './references';
import { renderContent } from './renderer';

const PROSE = '<p>The first paragraph.</p><p>The second one.</p>';

describe('splitReferences', () => {
  it('returns the body untouched when there is no references block', () => {
    expect(splitReferences(PROSE)).toEqual({ body: PROSE, references: null });
  });

  it('lifts a trailing references section out of the body', () => {
    const block = renderReferences([{ n: 1, url: 'https://ons.gov.uk/a', title: 'ONS' }]);
    const { body, references } = splitReferences(PROSE + block);
    expect(body).toBe(PROSE);
    expect(references).toBe(block);
  });

  // The legacy shape is what every post written before this change carries.
  // If this stops matching, those posts keep their sources in the reading
  // column and the whole feature silently does nothing for existing writing.
  it('lifts the legacy <hr><h3>Sources</h3> tail and rewraps it', () => {
    const legacy =
      '<hr><h3>Sources</h3><ol class="footnotes">' +
      '<li id="fn-1">ONS — <a href="https://ons.gov.uk/a">https://ons.gov.uk/a</a></li>' +
      '</ol>';
    const { body, references } = splitReferences(PROSE + legacy);
    expect(body).toBe(PROSE);
    expect(references).toContain('<section class="references">');
    expect(references).toContain('fn-1');
    expect(references).not.toContain('<h3>');
  });

  it('leaves a references section that is NOT at the end alone', () => {
    const block = renderReferences([{ n: 1, url: 'https://gov.uk/x', title: 'X' }]);
    const html = PROSE + block + '<p>More prose after it.</p>';
    expect(splitReferences(html).references).toBeNull();
  });
});

describe('stripReferences', () => {
  it('removes the block so the prose can be measured on its own', () => {
    const html = withReferences(PROSE, [{ n: 1, url: 'https://bbc.co.uk/n', title: 'BBC' }]);
    expect(stripReferences(html)).toBe(PROSE);
    expect(stripReferences(html)).not.toContain('bbc.co.uk');
  });
});

describe('renderReferences / parseReferences', () => {
  it('round-trips entries', () => {
    const refs = [
      { n: 2, url: 'https://ons.gov.uk/b', title: 'Population estimates' },
      { n: 1, url: 'https://bbc.co.uk/a', title: 'BBC News' },
    ];
    const parsed = parseReferences(withReferences(PROSE, refs));
    expect(parsed.map((r) => r.n)).toEqual([1, 2]);
    expect(parsed[0].url).toBe('https://bbc.co.uk/a');
    expect(parsed[0].title).toBe('BBC News');
  });

  it('numbers in order regardless of insertion order', () => {
    const html = withReferences(PROSE, [
      { n: 3, url: 'https://a.uk/', title: 'A' },
      { n: 1, url: 'https://b.uk/', title: 'B' },
    ]);
    expect(html.indexOf('fn-1')).toBeLessThan(html.indexOf('fn-3'));
  });

  it('escapes a title that contains markup', () => {
    const html = renderReferences([{ n: 1, url: 'https://x.uk/', title: '<script>bad()</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('replaces rather than appends a second time', () => {
    const once = withReferences(PROSE, [{ n: 1, url: 'https://a.uk/', title: 'A' }]);
    const twice = withReferences(once, [{ n: 1, url: 'https://b.uk/', title: 'B' }]);
    expect((twice.match(/<section class="references">/g) ?? []).length).toBe(1);
    expect(twice).toContain('b.uk');
    expect(twice).not.toContain('a.uk');
  });
});

describe('nextReferenceNumber', () => {
  it('starts at 1 and continues from the highest existing marker', () => {
    expect(nextReferenceNumber(PROSE)).toBe(1);
    const html = withReferences(PROSE, [
      { n: 1, url: 'https://a.uk/', title: '' },
      { n: 4, url: 'https://b.uk/', title: '' },
    ]);
    expect(nextReferenceNumber(html)).toBe(5);
  });
});

// The failure this guards is the one the whole editorial-furniture note in
// tiptap-extras warns about: an element that round-trips in the editor and is
// stripped on publish. A green test over either half alone proves nothing.
describe('the sanitiser admits what we generate', () => {
  it('keeps the references block intact through renderContent', () => {
    const html = withReferences(PROSE, [
      { n: 1, url: 'https://ons.gov.uk/a', title: 'ONS' },
    ]);
    const out = renderContent(html, 'html');
    expect(out).toContain('<section class="references">');
    expect(out).toContain('<ol class="footnotes">');
    expect(out).toContain('id="fn-1"');
    expect(out).toContain('href="https://ons.gov.uk/a"');
  });

  it('keeps the inline marker intact through renderContent', () => {
    const out = renderContent(`<p>A claim${referenceMarker(1)}.</p>`, 'html');
    expect(out).toContain('class="ref-mark"');
    expect(out).toContain('href="#fn-1"');
  });
});
