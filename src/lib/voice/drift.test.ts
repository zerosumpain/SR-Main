import { describe, expect, it } from 'vitest';
import { compareDrift } from './drift';
import type { VoiceCard, Measured } from './types';

function measured(over: Partial<Measured> = {}): Measured {
  return {
    posts: 5,
    words: 3198,
    sentences: 168,
    paragraphs: 55,
    fleschReadingEase: 63.8,
    fleschKincaidGrade: 10,
    audience: 'Plain English',
    sentenceWords: { median: 19, p90: 43, max: 78 },
    paragraphWords: { median: 58, p90: 121, max: 200 },
    shortSentenceRate: 0.13,
    rates: {
      contractions: 31.27, firstPerson: 46.28, emDash: 3.75, semicolon: 2.19,
      colon: 0, parenthetical: 1.56, exclamation: 3.13, question: 2.19,
      britishSpellings: 6.88, americanisms: 0,
    },
    distinctive: [],
    ...over,
  };
}

const card = (m: Measured): VoiceCard => ({
  version: 3,
  builtAt: 'corpus-test',
  invariants: [], persona: [], neverDo: [], tensions: [],
  corpus: { posts: 5, words: 3198, contrastPosts: 2, contrastWords: 1253, sourceNote: '' },
  registers: {
    'public-prose': { register: 'public-prose', usesPersona: true, rules: [], avoid: [], exemplarIds: [], measured: m },
    explanatory: { register: 'explanatory', usesPersona: true, rules: [], avoid: [], exemplarIds: [] },
    chat: { register: 'chat', usesPersona: false, rules: [], avoid: [], exemplarIds: [] },
    terse: { register: 'terse', usesPersona: false, rules: [], avoid: [], exemplarIds: [] },
  },
});

describe('compareDrift', () => {
  it('reports nothing when the corpus has not moved', () => {
    const r = compareDrift(card(measured()), measured());
    expect(r.material).toBe(false);
    expect(r.newPosts).toBe(0);
    expect(r.items.every((i) => !i.material)).toBe(true);
    expect(r.summary).toContain('still describes him');
  });

  it('treats a new post as material on its own', () => {
    // The clearest reason to rebuild, even if every rate happens to hold.
    const r = compareDrift(card(measured()), measured({ posts: 6, words: 4100 }));
    expect(r.newPosts).toBe(1);
    expect(r.material).toBe(true);
    expect(r.summary).toContain('never seen');
  });

  it('flags a metric that moves past the threshold', () => {
    const r = compareDrift(card(measured()), measured({ sentenceWords: { median: 9, p90: 22, max: 40 } }));
    const item = r.items.find((i) => i.metric === 'sentence median (words)');
    expect(item?.material).toBe(true);
    expect(item?.changePct).toBeLessThan(-25);
    expect(r.material).toBe(true);
  });

  it('ignores a large percentage change on a tiny base', () => {
    // Colons 0 → 1 per 1,000 words is a 100% move and means nothing. The
    // absolute floor is what stops the report crying wolf every month.
    const rates = { ...measured().rates, colon: 0.4 };
    const r = compareDrift(card(measured()), measured({ rates }));
    expect(r.items.find((i) => i.metric === 'colons / 1k')?.material).toBe(false);
  });

  it('does flag colons once they are genuinely present', () => {
    const rates = { ...measured().rates, colon: 4 };
    const r = compareDrift(card(measured()), measured({ rates }));
    expect(r.items.find((i) => i.metric === 'colons / 1k')?.material).toBe(true);
  });

  it('never proposes applying anything itself', () => {
    const r = compareDrift(card(measured()), measured({ posts: 7, words: 5000 }));
    expect(r.summary).toContain('Nothing has been changed automatically');
    expect(r.summary).toMatch(/build-voice-card/);
  });

  it('says so plainly when the register has never been measured', () => {
    const c = card(measured());
    delete c.registers['public-prose'].measured;
    const r = compareDrift(c, measured());
    expect(r.material).toBe(true);
    expect(r.summary).toContain('nothing to compare against');
  });
});
