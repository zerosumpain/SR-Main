import { describe, expect, it, beforeEach } from 'vitest';
import { getVoiceCard, getExemplars, getRegisterExemplars, clearVoiceCache, parseExemplar } from './card';
import { REGISTERS } from './types';

describe('parseExemplar', () => {
  const good = `---
register: public-prose
shows: An opening
sourcePostId: 13
sourceSlug: i-built-a-thing
---

I built a thing.`;

  it('reads frontmatter and body', () => {
    const e = parseExemplar('01-x.md', good);
    expect(e).toMatchObject({
      id: '01-x',
      register: 'public-prose',
      shows: 'An opening',
      sourcePostId: 13,
      sourceSlug: 'i-built-a-thing',
      text: 'I built a thing.',
    });
  });

  it('rejects a file with no frontmatter rather than guessing', () => {
    expect(parseExemplar('x.md', 'just some prose')).toBeNull();
  });

  it('rejects an unknown register', () => {
    expect(parseExemplar('x.md', good.replace('public-prose', 'shouting'))).toBeNull();
  });

  it('rejects an empty body — an exemplar with no text teaches nothing', () => {
    expect(parseExemplar('x.md', good.replace('I built a thing.', ''))).toBeNull();
  });

  it('keeps a colon inside a value', () => {
    const e = parseExemplar('x.md', good.replace('An opening', 'An opening: flat, declarative'));
    expect(e?.shows).toBe('An opening: flat, declarative');
  });
});

describe('the committed card', () => {
  beforeEach(() => clearVoiceCache());

  it('loads and carries every register', () => {
    const card = getVoiceCard();
    expect(card).not.toBeNull();
    for (const r of REGISTERS) expect(card!.registers[r]).toBeDefined();
  });

  it('measures public-prose over human posts only', () => {
    const m = getVoiceCard()!.registers['public-prose'].measured!;
    expect(m.posts).toBe(5);
    expect(m.words).toBe(3198);
    // The corpus is small enough that the card must say so.
    expect(m.caveat).toBeTruthy();
  });

  it('records zero americanisms — the scorer keys off this baseline', () => {
    expect(getVoiceCard()!.registers['public-prose'].measured!.rates.americanisms).toBe(0);
  });

  it('leaves explanatory and terse unmeasured rather than inventing figures', () => {
    const card = getVoiceCard()!;
    expect(card.registers.explanatory.measured).toBeUndefined();
    expect(card.registers.terse.measured).toBeUndefined();
    expect(card.registers.chat.measured).toBeDefined();
  });

  it('writes down where the rules disagree with the evidence', () => {
    const tensions = getVoiceCard()!.tensions;
    expect(tensions.length).toBeGreaterThan(0);
    expect(tensions.join(' ')).toMatch(/exclamation/i);
  });

  it('resolves every exemplar id the card names', () => {
    const card = getVoiceCard()!;
    for (const r of REGISTERS) {
      const named = card.registers[r].exemplarIds;
      expect(getRegisterExemplars(r).map((e) => e.id)).toEqual(named);
    }
  });

  it('draws exemplars from blog posts only, as the plan requires', () => {
    for (const e of getExemplars()) {
      expect(e.register).toBe('public-prose');
      expect(e.sourcePostId).toBeGreaterThan(0);
      expect(e.text.length).toBeGreaterThan(80);
    }
  });
});
