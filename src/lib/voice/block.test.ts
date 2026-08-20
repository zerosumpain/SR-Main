import { describe, expect, it } from 'vitest';
import { renderVoiceBlock, voiceBlock, approxTokens } from './block';
import type { VoiceCard, Exemplar } from './types';
import { REGISTERS } from './types';

const card: VoiceCard = {
  version: 2,
  builtAt: 'corpus-test',
  invariants: ['British English throughout.'],
  persona: ['Write as John, in the first person.'],
  neverDo: ['No exclamation marks.', 'No Americanisms.'],
  tensions: [],
  corpus: { posts: 5, words: 3198, contrastPosts: 2, contrastWords: 1253, sourceNote: '' },
  registers: {
    'public-prose': {
      register: 'public-prose',
      usesPersona: true,
      rules: ['Open flat.'],
      avoid: ['A gag in every line.'],
      exemplarIds: ['a', 'b'],
      measured: {
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
          contractions: 31.27,
          firstPerson: 46.28,
          emDash: 3.75,
          semicolon: 2.19,
          colon: 0,
          parenthetical: 1.56,
          exclamation: 3.13,
          question: 2.19,
          britishSpellings: 6.88,
          americanisms: 0,
        },
        distinctive: [],
      },
    },
    explanatory: { register: 'explanatory', usesPersona: true, rules: ['Plain English.'], avoid: [], exemplarIds: [] },
    chat: {
      register: 'chat',
      usesPersona: false,
      bandsDescribeOutput: false,
      rules: ['Short.'],
      avoid: [],
      exemplarIds: [],
      // Real numbers, not a cast-to-never stub: the chat branch of
      // renderVoiceBlock reads median, p90 and shortSentenceRate straight out
      // of here, so a stub asserts nothing about the sentence it builds.
      measured: {
        posts: 0,
        words: 90712,
        sentences: 1106,
        paragraphs: 1106,
        fleschReadingEase: 70,
        fleschKincaidGrade: 6,
        audience: 'Plain English',
        sentenceWords: { median: 10, p90: 20, max: 60 },
        paragraphWords: { median: 12, p90: 26, max: 80 },
        shortSentenceRate: 0.28,
        rates: {
          contractions: 20,
          firstPerson: 40,
          emDash: 1,
          semicolon: 0,
          colon: 0,
          parenthetical: 1,
          exclamation: 1,
          question: 30,
          britishSpellings: 3,
          americanisms: 0,
        },
        distinctive: [],
      },
    },
    terse: { register: 'terse', usesPersona: false, rules: ['One line.'], avoid: ['Personality.'], exemplarIds: [] },
  },
};

const exemplars: Exemplar[] = [
  { id: 'a', register: 'public-prose', shows: 'An opening', sourcePostId: 13, sourceSlug: 's', text: 'I built a thing.' },
  { id: 'b', register: 'public-prose', shows: 'An aside', sourcePostId: 13, sourceSlug: 's', text: 'My smooth brain.' },
  { id: 'c', register: 'public-prose', shows: 'A close', sourcePostId: 6, sourceSlug: 's', text: 'All I needed was Claude.' },
];

describe('renderVoiceBlock', () => {
  it('carries the persona into registers that write as John', () => {
    expect(renderVoiceBlock(card, 'public-prose', exemplars)).toContain('Write as John');
  });

  it('keeps the persona OUT of terse — a changelog is not him talking', () => {
    const block = renderVoiceBlock(card, 'terse', []);
    expect(block).not.toContain('Write as John');
    expect(block).not.toContain('No exclamation marks');
    // Conventions still apply everywhere.
    expect(block).toContain('British English');
  });

  it('states the long-sentence band, which is the thing the old prompt got wrong', () => {
    const block = renderVoiceBlock(card, 'public-prose', exemplars);
    expect(block).toContain('median 19');
    expect(block).toMatch(/Do not chop them into short ones/);
  });

  it('frames measurements as bands rather than targets', () => {
    expect(renderVoiceBlock(card, 'public-prose', exemplars)).toContain('bands to stay inside');
  });

  it('surfaces the zero-colon and zero-americanism facts only when they are true', () => {
    const block = renderVoiceBlock(card, 'public-prose', exemplars);
    expect(block).toContain('does not use colons');

    const withColons = structuredClone(card);
    withColons.registers['public-prose'].measured!.rates.colon = 4;
    expect(renderVoiceBlock(withColons, 'public-prose', exemplars)).not.toContain('does not use colons');
  });

  it('takes the first N exemplars, stably — rotation would break prompt caching', () => {
    const twice = [
      renderVoiceBlock(card, 'public-prose', exemplars, { exemplars: 2 }),
      renderVoiceBlock(card, 'public-prose', exemplars, { exemplars: 2 }),
    ];
    expect(twice[0]).toBe(twice[1]);
    expect(twice[0]).toContain('I built a thing.');
    expect(twice[0]).toContain('My smooth brain.');
    expect(twice[0]).not.toContain('All I needed was Claude.');
  });

  it('omits exemplars when asked for none', () => {
    expect(renderVoiceBlock(card, 'public-prose', exemplars, { exemplars: 0 })).not.toContain('I built a thing.');
  });

  it('caps the prohibition list so it stays readable', () => {
    const many = structuredClone(card);
    many.neverDo = Array.from({ length: 20 }, (_, i) => `Rule ${i}.`);
    const block = renderVoiceBlock(many, 'public-prose', exemplars, { maxAvoid: 3 });
    const neverCount = block.split('Never:')[1].split('\n\n')[0].split('\n').filter((l) => l.startsWith('- ')).length;
    expect(neverCount).toBe(3);
  });

  it('drops the bands when the caller does not want them', () => {
    expect(renderVoiceBlock(card, 'public-prose', exemplars, { bands: false })).not.toContain('median 19');
  });
});

describe('chat is about the counterpart, not the author', () => {
  it('never tells the assistant to write as John', () => {
    // jkai replies TO him; it does not write AS him. An earlier version handed
    // the persona and his own first-person density to the assistant as targets.
    const block = voiceBlock('chat');
    expect(block).not.toContain('Write as John');
    expect(block).not.toContain('uses of I/me/my');
  });

  it('frames his measurements as who you are answering', () => {
    const block = voiceBlock('chat');
    expect(block).toContain('Who you are answering');
    expect(block).toContain('These are HIS numbers, not a target for yours');
  });

  it('still gives public-prose its bands as targets', () => {
    expect(voiceBlock('public-prose', { exemplars: 0 })).toContain('bands to stay inside');
  });
});

describe('voiceBlock against the committed card', () => {
  it('produces a block for every register', () => {
    for (const r of REGISTERS) expect(voiceBlock(r).length).toBeGreaterThan(100);
  });

  it('stays within a sane token budget', () => {
    // public-prose carries two exemplars and is the largest by design. It rides
    // on a prompt that already includes the post body, so the ceiling is about
    // attention, not cost.
    expect(approxTokens(voiceBlock('public-prose', { exemplars: 2 }))).toBeLessThan(1200);
    expect(approxTokens(voiceBlock('terse'))).toBeLessThan(300);
    expect(approxTokens(voiceBlock('chat'))).toBeLessThan(600);
  });

  it('is byte-identical across calls, so the prompt prefix stays cacheable', () => {
    expect(voiceBlock('chat')).toBe(voiceBlock('chat'));
  });
});
