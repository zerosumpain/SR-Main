import { describe, it, expect } from 'vitest';
import { segmentBody } from './segment';
import {
  filterRewrites,
  parseRewrites,
  renderForAutopilot,
  riskyParagraphs,
  rewriteAddress,
  rewriteScope,
  type Rewrite,
} from './autopilot';

const POST = [
  '<p>The first paragraph is entirely plain. It has two sentences.</p>',
  '<p>This one cites <a href="https://example.com/docs">the documentation</a> and must never be rewritten.</p>',
  '<p>A third paragraph, also plain, with one long sentence that rambles on for a while.</p>',
  '<p>Emphasis like <em>this</em> is not a reason to exclude a paragraph.</p>',
].join('');

describe('riskyParagraphs', () => {
  // THE test for this module. riskyParagraphs and segmentBody index paragraphs
  // independently; if they ever disagree the exclusion silently protects the
  // wrong paragraph, and a link gets deleted by a rewrite that looked safe.
  it('indexes paragraphs identically to segmentBody', () => {
    const seg = segmentBody(POST);
    const risky = riskyParagraphs(POST);

    expect(seg.paragraphs).toHaveLength(4);
    expect([...risky]).toEqual([1]);
    // The excluded index must be the paragraph that actually holds the link.
    expect(seg.paragraphs[1].text).toContain('the documentation');
  });

  it('stays aligned when a paragraph spans several source lines', () => {
    const wrapped = '<p>One.</p>\n<p>Two with <a href="/x">a link</a>\n  spilling over a line.</p>\n<p>Three.</p>';
    const seg = segmentBody(wrapped);
    const risky = riskyParagraphs(wrapped);
    for (const idx of risky) {
      expect(seg.paragraphs[idx]?.text ?? '').toContain('a link');
    }
  });

  it('treats emphasis as safe and links, code, media and footnotes as risky', () => {
    expect(riskyParagraphs('<p>Just <em>emphasis</em>.</p>').size).toBe(0);
    expect(riskyParagraphs('<p>Just <strong>bold</strong>.</p>').size).toBe(0);
    for (const markup of [
      '<a href="/a">x</a>',
      '<img src="/a.png" alt="a">',
      '<code>x</code>',
      '<sup id="fn1">1</sup>',
    ]) {
      expect(riskyParagraphs(`<p>Text ${markup} more.</p>`).size, markup).toBe(1);
    }
  });

  it('marks an excluded paragraph as UNAVAILABLE in the prompt', () => {
    const rendered = renderForAutopilot(segmentBody(POST), riskyParagraphs(POST));
    expect(rendered).toContain('[1] UNAVAILABLE');
    // and offers no addressable sentence inside it
    expect(rendered).not.toContain('[1.0]');
    expect(rendered).toContain('[0.0]');
    // Paragraph 2 is a single sentence, so it is offered ONLY as [2] — naming
    // the same prose twice invites two proposals against one piece of text.
    expect(rendered).toContain('[2] A third paragraph');
    expect(rendered).not.toContain('[2.0]');
  });

  // The paragraph is the unit now. If the prompt ever stops leading with it,
  // every pass goes back to addressing clauses and the suggestions shrink.
  it('offers the whole paragraph first, then its sentences', () => {
    const rendered = renderForAutopilot(segmentBody(POST), riskyParagraphs(POST));
    expect(rendered).toContain('[0] The first paragraph is entirely plain. It has two sentences.');
    expect(rendered.indexOf('[0] The first')).toBeLessThan(rendered.indexOf('[0.0]'));
  });
  // The regression test for a defect autopilot found in its first live run: a
  // table collapsed into ONE run-on paragraph and the model offered to rewrite
  // it as flowing prose. Accepting that would have destroyed the table.
  it('splits table cells apart and refuses to touch a table', () => {
    const withTable =
      '<p>Before.</p><table><tbody><tr><td>Thing</td><td>Value</td></tr><tr><td>Rows</td><td>Have rules</td></tr></tbody></table><p>After.</p>';
    const seg = segmentBody(withTable);
    const risky = riskyParagraphs(withTable);

    // Cells are their own paragraphs, not one blob.
    const texts = seg.paragraphs.map((p) => p.text);
    expect(texts).toContain('Thing');
    expect(texts).toContain('Value');
    expect(texts.some((t) => t.includes('ThingValue'))).toBe(false);

    // And the whole table is off-limits regardless.
    const rendered = renderForAutopilot(seg, risky);
    expect(rendered).toContain('UNAVAILABLE');
  });

  it('holds back a disclosure and a callout', () => {
    for (const html of [
      '<details><summary>More</summary><p>Body</p></details>',
      '<aside class="callout-note"><p>Note</p></aside>',
    ]) {
      expect(riskyParagraphs(html).size, html).toBeGreaterThan(0);
    }
  });

});

describe('parseRewrites', () => {
  it('reads a well-formed response', () => {
    const out = parseRewrites('{"rewrites":[{"paragraphIdx":0,"sentenceIdx":1,"suggested":"New.","reason":"why"}]}');
    expect(out).toEqual([{ paragraphIdx: 0, sentenceIdx: 1, suggested: 'New.', reason: 'why' }]);
  });

  it('returns nothing rather than throwing on junk', () => {
    expect(parseRewrites('not json')).toEqual([]);
    expect(parseRewrites('{}')).toEqual([]);
    expect(parseRewrites('{"rewrites":"nope"}')).toEqual([]);
    expect(parseRewrites('null')).toEqual([]);
  });

  it('drops malformed entries but keeps the good ones beside them', () => {
    const out = parseRewrites(
      '{"rewrites":[{"paragraphIdx":"x","sentenceIdx":0,"suggested":"a"},{"paragraphIdx":1,"sentenceIdx":0,"suggested":""},{"paragraphIdx":2,"sentenceIdx":0,"suggested":"good"}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0].paragraphIdx).toBe(2);
    // A missing reason gets a default rather than an empty margin note.
    expect(out[0].reason).toBeTruthy();
  });

  it('honours the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ paragraphIdx: i, sentenceIdx: 0, suggested: 'x' }));
    expect(parseRewrites(JSON.stringify({ rewrites: many }), 8)).toHaveLength(8);
  });
});

describe('filterRewrites', () => {
  const risky = riskyParagraphs(POST);
  const rw = (over: Partial<Rewrite>): Rewrite => ({
    paragraphIdx: 0,
    sentenceIdx: 0,
    suggested: 'A genuinely different opening sentence.',
    reason: 'because',
    ...over,
  });

  it('keeps a real rewrite', () => {
    const { kept, dropped } = filterRewrites([rw({})], POST, risky);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  // The one that matters: a rewrite inside the linked paragraph must never
  // reach the author, because accepting it would delete the link.
  it('refuses a rewrite in a paragraph that holds a link', () => {
    const { kept, dropped } = filterRewrites([rw({ paragraphIdx: 1, sentenceIdx: 0 })], POST, risky);
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toMatch(/link or embedded media/);
  });

  it('drops a no-op rewrite', () => {
    const seg = segmentBody(POST);
    const same = seg.paragraphs[0].sentences[0];
    const { kept, dropped } = filterRewrites([rw({ suggested: same })], POST, risky);
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toBe('identical to the original');
  });

  it('drops a rewrite that only changed whitespace', () => {
    const seg = segmentBody(POST);
    const padded = `  ${seg.paragraphs[0].sentences[0]}   `;
    const { kept } = filterRewrites([rw({ suggested: padded })], POST, risky);
    expect(kept).toHaveLength(0);
  });

  it('drops markup, an out-of-range index, and a duplicate', () => {
    const { kept, dropped } = filterRewrites(
      [
        rw({ suggested: '<p>Wrapped in a tag.</p>' }),
        rw({ paragraphIdx: 99, sentenceIdx: 0 }),
        rw({ sentenceIdx: 1, suggested: 'One.' }),
        rw({ sentenceIdx: 1, suggested: 'Two.' }),
      ],
      POST,
      risky,
    );
    expect(kept).toHaveLength(1);
    expect(dropped.map((d) => d.why)).toEqual([
      'contains markup',
      'no sentence at that index',
      'duplicate index',
    ]);
  });

  it('drops a "rewrite" that is really a new paragraph', () => {
    const { kept, dropped } = filterRewrites([rw({ suggested: 'x'.repeat(1200) })], POST, risky);
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toBe('far longer than the original');
  });
});


// ---------------------------------------------------------------------------
// Paragraph-scoped rewrites (2026-09-04). The unit changed from the sentence to
// the paragraph; these cover the parts of that change that can go wrong
// silently.
// ---------------------------------------------------------------------------

describe('paragraph-scoped rewrites', () => {
  const json = (rewrites: unknown[]) => JSON.stringify({ rewrites });

  it('reads an explicit null sentenceIdx as "the whole paragraph"', () => {
    const [r] = parseRewrites(json([{ paragraphIdx: 2, sentenceIdx: null, suggested: 'New text.', reason: 'r' }]));
    expect(r.sentenceIdx).toBeNull();
    expect(rewriteScope(r)).toBe('paragraph');
    expect(rewriteAddress(r)).toBe('2');
  });

  // The model expresses "whole paragraph" in several ways. Dropping any of them
  // would silently discard the output this pass exists to produce.
  it.each([
    ['omitted', { paragraphIdx: 0, suggested: 'x', reason: 'r' }],
    ['undefined', { paragraphIdx: 0, sentenceIdx: undefined, suggested: 'x', reason: 'r' }],
    ['a string', { paragraphIdx: 0, sentenceIdx: 'all', suggested: 'x', reason: 'r' }],
    ['negative', { paragraphIdx: 0, sentenceIdx: -1, suggested: 'x', reason: 'r' }],
  ])('treats a %s sentenceIdx as a paragraph rewrite', (_label, obj) => {
    const [r] = parseRewrites(json([obj]));
    expect(r).toBeDefined();
    expect(r.sentenceIdx).toBeNull();
  });

  it('still accepts a genuine sentence index', () => {
    const [r] = parseRewrites(json([{ paragraphIdx: 1, sentenceIdx: 0, suggested: 'x', reason: 'r' }]));
    expect(r.sentenceIdx).toBe(0);
    expect(rewriteScope(r)).toBe('sentence');
    expect(rewriteAddress(r)).toBe('1.0');
  });

  it('resolves a paragraph rewrite against the whole paragraph', () => {
    const rewrites: Rewrite[] = [
      { paragraphIdx: 0, sentenceIdx: null, suggested: 'One rewritten paragraph that says the same thing rather differently.', reason: 'r' },
    ];
    const { kept, dropped } = filterRewrites(rewrites, POST, riskyParagraphs(POST));
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it('refuses a paragraph rewrite on a paragraph holding a link', () => {
    const rewrites: Rewrite[] = [
      { paragraphIdx: 1, sentenceIdx: null, suggested: 'A plain replacement that would delete the anchor tag.', reason: 'r' },
    ];
    const { kept, dropped } = filterRewrites(rewrites, POST, riskyParagraphs(POST));
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toMatch(/link or embedded media/);
  });

  // Accepting both applies one on top of the other, and the second anchor no
  // longer exists in the document.
  it('drops a sentence rewrite inside a paragraph that is already being replaced', () => {
    const rewrites: Rewrite[] = [
      { paragraphIdx: 0, sentenceIdx: null, suggested: 'A whole new opening paragraph with rather more to say.', reason: 'r' },
      { paragraphIdx: 0, sentenceIdx: 1, suggested: 'It has two sentences, still.', reason: 'r' },
    ];
    const { kept, dropped } = filterRewrites(rewrites, POST, riskyParagraphs(POST));
    expect(kept).toHaveLength(1);
    expect(kept[0].sentenceIdx).toBeNull();
    expect(dropped[0].why).toMatch(/already being rewritten/);
  });

  it('drops a paragraph rewrite that summarised instead of editing', () => {
    const rewrites: Rewrite[] = [
      { paragraphIdx: 2, sentenceIdx: null, suggested: 'Short.', reason: 'r' },
    ];
    const { kept, dropped } = filterRewrites(rewrites, POST, riskyParagraphs(POST));
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toMatch(/summary/);
  });

  it('drops a paragraph rewrite that ran away into a new section', () => {
    const long = 'A new sentence that keeps going and going. '.repeat(40);
    const { kept, dropped } = filterRewrites(
      [{ paragraphIdx: 2, sentenceIdx: null, suggested: long, reason: 'r' }],
      POST,
      riskyParagraphs(POST),
    );
    expect(kept).toHaveLength(0);
    expect(dropped[0].why).toMatch(/far longer/);
  });

  it('does not apply the paragraph length floor to a sentence rewrite', () => {
    const { kept } = filterRewrites(
      [{ paragraphIdx: 0, sentenceIdx: 0, suggested: 'Plain.', reason: 'r' }],
      POST,
      riskyParagraphs(POST),
    );
    expect(kept).toHaveLength(1);
  });
});

// The sources block is not prose. If segmentBody and riskyParagraphs ever
// disagree about that, every paragraph index after the references shifts by one
// in exactly one of them — and the link exclusion then guards the wrong
// paragraph while still reporting that it guarded something.
describe('references are invisible to the pass', () => {
  const withRefs =
    POST +
    '<section class="references"><ol class="footnotes">' +
    '<li id="fn-1">ONS — <a href="https://ons.gov.uk/a">https://ons.gov.uk/a</a></li>' +
    '</ol></section>';

  it('segments the same paragraphs with or without a references block', () => {
    expect(segmentBody(withRefs).paragraphs).toHaveLength(segmentBody(POST).paragraphs.length);
  });

  it('keeps riskyParagraphs aligned with segmentBody', () => {
    const seg = segmentBody(withRefs);
    const risky = riskyParagraphs(withRefs);
    expect([...risky]).toEqual([1]);
    expect(seg.paragraphs[1].text).toContain('the documentation');
  });

  it('never offers a citation as rewritable prose', () => {
    expect(renderForAutopilot(segmentBody(withRefs), riskyParagraphs(withRefs))).not.toContain('ons.gov.uk');
  });
});
