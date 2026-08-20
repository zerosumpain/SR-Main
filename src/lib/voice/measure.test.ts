import { describe, expect, it } from 'vitest';
import {
  extractParagraphs,
  splitSentences,
  spread,
  tokenise,
  distinctiveTerms,
  measure,
  CONFIDENT_CORPUS_WORDS,
} from './measure';

describe('extractParagraphs', () => {
  it('splits on block boundaries rather than collapsing the post', () => {
    const html = '<p>One sentence.</p><p>Another one.</p><h2>A heading</h2>';
    expect(extractParagraphs(html)).toEqual(['One sentence.', 'Another one.', 'A heading']);
  });

  it('treats <br> as a paragraph break', () => {
    expect(extractParagraphs('<p>First<br>Second</p>')).toEqual(['First', 'Second']);
  });

  it('drops code blocks — they are not prose', () => {
    const html = '<p>Prose here.</p><pre><code>const x = 1;</code></pre>';
    expect(extractParagraphs(html)).toEqual(['Prose here.']);
  });

  it('returns nothing for empty input', () => {
    expect(extractParagraphs('')).toEqual([]);
  });
});

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does not split on a guarded abbreviation', () => {
    expect(splitSentences('Use a tool, e.g. ripgrep, and move on.')).toEqual([
      'Use a tool, e.g. ripgrep, and move on.',
    ]);
  });
});

describe('spread', () => {
  it('reports median and p90, not a mean', () => {
    // A mean would be dragged to ~14 by the outlier; the median holds at 5.
    const s = spread([3, 4, 5, 5, 6, 7, 100]);
    expect(s.median).toBe(5);
    expect(s.max).toBe(100);
    expect(s.p90).toBe(100);
  });

  it('handles an empty set', () => {
    expect(spread([])).toEqual({ median: 0, p90: 0, max: 0 });
  });
});

describe('tokenise', () => {
  it('keeps internal apostrophes and drops trailing ones', () => {
    expect(tokenise("I'm not — it's John's.")).toEqual(["i'm", 'not', "it's", "john's"]);
  });
});

describe('distinctiveTerms', () => {
  it('surfaces a term that is genuinely over-represented', () => {
    const target = ['thing thing thing thing thing widget widget alpha beta gamma delta'];
    const contrast = ['widget widget widget alpha beta gamma delta epsilon zeta eta theta'];
    const terms = distinctiveTerms(target, contrast, { minCount: 3 });
    expect(terms[0].term).toBe('thing');
    expect(terms[0].z).toBeGreaterThan(0);
  });

  it('suppresses terms below minCount however they score', () => {
    const terms = distinctiveTerms(['unicorn appears once here'], ['nothing like it at all'], {
      minCount: 4,
    });
    expect(terms.find((t) => t.term === 'unicorn')).toBeUndefined();
  });

  it('returns nothing when there is no contrast corpus', () => {
    expect(measure({ documents: ['<p>Some prose here.</p>'] }).distinctive).toEqual([]);
  });
});

describe('measure', () => {
  const johnish =
    '<p>I built a thing and I wanted to share it. In fact - it\'s this thing. ' +
    "you're on it, reading this post.</p><p>It does other stuff too and I quite like it.</p>";

  it('counts structure the way a reader would', () => {
    const m = measure({ documents: [johnish] });
    expect(m.posts).toBe(1);
    expect(m.paragraphs).toBe(2);
    expect(m.sentences).toBe(4);
    expect(m.words).toBeGreaterThan(20);
  });

  it('picks up contractions and first person', () => {
    const m = measure({ documents: [johnish] });
    expect(m.rates.contractions).toBeGreaterThan(0);
    expect(m.rates.firstPerson).toBeGreaterThan(0);
  });

  it('flags americanisms as a rate, so they can be gated on', () => {
    const m = measure({ documents: ['<p>The color of the organization center.</p>'] });
    expect(m.rates.americanisms).toBeGreaterThan(0);
    expect(m.rates.britishSpellings).toBe(0);
  });

  it('scores british spellings without flagging them as defects', () => {
    const m = measure({ documents: ['<p>We recognise the programme and its colour.</p>'] });
    expect(m.rates.britishSpellings).toBeGreaterThan(0);
    expect(m.rates.americanisms).toBe(0);
  });

  it('measures short sentences rather than claiming to detect fragments', () => {
    const m = measure({ documents: ['<p>Short. Also short. This sentence is a good deal longer than the others here.</p>'] });
    expect(m.shortSentenceRate).toBeCloseTo(0.67, 1);
  });

  it('attaches a caveat below the confidence floor', () => {
    const m = measure({ documents: [johnish] });
    expect(m.caveat).toContain('bands to stay inside');
    expect(CONFIDENT_CORPUS_WORDS).toBeGreaterThan(0);
  });

  it('is deterministic — the same input measures identically twice', () => {
    expect(measure({ documents: [johnish] })).toEqual(measure({ documents: [johnish] }));
  });

  it('handles plain text documents when told they are not HTML', () => {
    const m = measure({ documents: ['First para.\n\nSecond para here.'], isHtml: false });
    expect(m.paragraphs).toBe(2);
  });
});
