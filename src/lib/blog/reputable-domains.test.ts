import { describe, it, expect } from 'vitest';
import {
  brandLabel,
  hostnameOf,
  isAcademic,
  isAffiliated,
  isReputable,
  isUkSource,
  rankSources,
  rateSource,
  ACADEMIC_BONUS,
  AFFILIATION_PENALTY,
  REPUTABLE_BONUS,
  UK_BONUS,
} from './reputable-domains';

describe('isUkSource', () => {
  it.each([
    'https://www.ons.gov.uk/economy/inflation',
    'https://bbc.co.uk/news/1',
    'https://www.theguardian.com/uk-news/x',
    'https://www.ft.com/content/abc',
    'https://www.bankofengland.co.uk/statistics',
    'https://www.legislation.gov.uk/ukpga/2018/12',
    'https://www.turing.ac.uk/research',
    'https://www.gov.scot/publications/x',
  ])('recognises %s', (url) => {
    expect(isUkSource(url)).toBe(true);
  });

  it.each([
    'https://www.washingtonpost.com/x',
    'https://www.cdc.gov/y',
    'https://www.nytimes.com/z',
    'https://ec.europa.eu/eurostat',
    'https://example.com/',
  ])('does not claim %s', (url) => {
    expect(isUkSource(url)).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    // `.uk` must be a suffix of a LABEL, not a substring. A domain ending
    // "...uk" without the dot is somebody else's.
    expect(isUkSource('https://notuk.com/')).toBe(false);
    expect(isUkSource('https://www.gov.uk.evil.com/')).toBe(false);
  });

  it('returns false rather than throwing on a non-URL', () => {
    expect(isUkSource('not a url')).toBe(false);
    expect(hostnameOf('not a url')).toBe('');
  });
});

// The behaviour John asked for: given two sources that could both be cited,
// the British one wins. Given a reputable non-UK source against an unvetted UK
// one, reputation still wins — a preference, not an allow-list.
describe('rateSource ranking', () => {
  const score = (url: string, relevance: number) => relevance + rateSource(url).bonus;

  it('prefers a UK source over an equally relevant US one', () => {
    expect(score('https://www.ons.gov.uk/a', 0.8)).toBeGreaterThan(score('https://www.cdc.gov/a', 0.8));
  });

  it('still ranks a reputable non-UK source above an unvetted UK blog', () => {
    expect(score('https://www.reuters.com/a', 0.5)).toBeGreaterThan(score('https://someones-blog.uk/a', 0.5));
  });

  it('lets a clearly more relevant source win anyway', () => {
    // The bonus decides ties; it does not override the search engine. A US
    // source that is genuinely the better match for an American subject still
    // comes first, which is the point of ranking rather than filtering.
    expect(score('https://www.washingtonpost.com/a', 0.95)).toBeGreaterThan(score('https://www.bbc.co.uk/a', 0.4));
  });

  it('keeps the UK bonus smaller than the reputable one', () => {
    expect(UK_BONUS).toBeLessThan(REPUTABLE_BONUS);
  });

  it('reports every flag so the panel can explain the order', () => {
    expect(rateSource('https://www.ons.gov.uk/a')).toEqual({
      reputable: true, uk: true, academic: false, affiliated: false, bonus: REPUTABLE_BONUS + UK_BONUS,
    });
    expect(rateSource('https://www.cdc.gov/a')).toEqual({
      reputable: true, uk: false, academic: false, affiliated: false, bonus: REPUTABLE_BONUS,
    });
    expect(rateSource('https://someones-blog.uk/a')).toEqual({
      reputable: false, uk: true, academic: false, affiliated: false, bonus: UK_BONUS,
    });
    expect(rateSource('https://example.com/a')).toEqual({
      reputable: false, uk: false, academic: false, affiliated: false, bonus: 0,
    });
  });

  it('leaves the reputable set unchanged', () => {
    expect(isReputable('https://www.nature.com/articles/x')).toBe(true);
    expect(isReputable('https://random-seo-farm.biz/x')).toBe(false);
  });
});


describe('isAcademic', () => {
  it.each([
    'https://www.ox.ac.uk/research/x',
    'https://www.lse.ac.uk/y',
    'https://www.turing.ac.uk/research',
    'https://www.ifs.org.uk/publications/1',
    'https://arxiv.org/abs/2401.00001',
    'https://www.mit.edu/z',
    // Repositories a live probe returned unflagged before they were listed.
    'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/',
    'https://papers.neurips.cc/paper/2017/hash/x',
    'https://aclanthology.org/2024.acl-1.1/',
    'https://openreview.net/forum?id=x',
  ])('recognises %s', (url) => {
    expect(isAcademic(url)).toBe(true);
  });

  // A publisher is not a university. Treating one as academic would rank a
  // paywalled abstract above the institution that produced the work.
  it.each([
    'https://www.nature.com/articles/x',
    'https://www.thelancet.com/journals/x',
    'https://www.bbc.co.uk/news/1',
    'https://www.ons.gov.uk/a',
  ])('does not claim %s', (url) => {
    expect(isAcademic(url)).toBe(false);
  });
});

describe('brandLabel', () => {
  it.each([
    ['https://www.acme.com/x', 'acme'],
    ['https://acme.co.uk/x', 'acme'],
    ['https://www.ox.ac.uk/x', 'ox'],
    ['https://sub.acme.org.uk/x', 'acme'],
    ['https://ons.gov.uk/x', 'ons'],
  ])('reduces %s to %s', (url, want) => {
    expect(brandLabel(url)).toBe(want);
  });
});

describe('isAffiliated', () => {
  it('flags the subject talking about itself', () => {
    expect(isAffiliated('https://www.acmecorp.com/press', 'AcmeCorp raised $40m in June')).toBe(true);
  });

  it('does not flag an independent source for the same claim', () => {
    expect(isAffiliated('https://www.ft.com/content/x', 'AcmeCorp raised $40m in June')).toBe(false);
  });

  it('flags a press wire whatever the claim', () => {
    expect(isAffiliated('https://www.prnewswire.com/x', 'anything at all')).toBe(true);
    expect(isAffiliated('https://www.businesswire.com/x')).toBe(true);
  });

  it('flags the site citing itself', () => {
    expect(isAffiliated('https://strangeramblings.com/blog/x')).toBe(true);
  });

  // The guard that stops "time" in a sentence flagging time.com, which would
  // quietly demote real publications on the strength of an ordinary word.
  it.each([
    ['https://time.com/x', 'It took a long time to build'],
    ['https://www.nature.com/x', 'the nature of the problem'],
    ['https://www.independent.co.uk/x', 'an independent review found'],
  ])('does not flag %s on a common word', (url, subject) => {
    expect(isAffiliated(url, subject)).toBe(false);
  });

  it('requires a whole-word match', () => {
    expect(isAffiliated('https://acme.com/x', 'the acmeforge tool shipped')).toBe(false);
  });

  it('is false with no subject and no wire', () => {
    expect(isAffiliated('https://acme.com/x')).toBe(false);
  });
});

// The ordering John asked for, stated as one test rather than left implicit in
// the constants.
describe('the preference order', () => {
  const score = (url: string, relevance: number, subject?: string) =>
    relevance + rateSource(url, subject).bonus;

  it('puts a UK university above every other equally relevant source', () => {
    const r = 0.7;
    const uni = score('https://www.ox.ac.uk/a', r);
    expect(uni).toBeGreaterThan(score('https://www.mit.edu/a', r));
    expect(uni).toBeGreaterThan(score('https://www.ons.gov.uk/a', r));
    expect(uni).toBeGreaterThan(score('https://www.bbc.co.uk/a', r));
    expect(uni).toBeGreaterThan(score('https://www.reuters.com/a', r));
  });

  it('ranks a non-UK academic above UK press', () => {
    expect(score('https://www.mit.edu/a', 0.7)).toBeGreaterThan(score('https://www.bbc.co.uk/a', 0.7));
  });

  it('drops an affiliated source below its own tier', () => {
    const subject = 'AcmeCorp raised $40m';
    expect(score('https://acmecorp.co.uk/a', 0.9, subject)).toBeLessThan(score('https://www.bbc.co.uk/a', 0.9, subject));
  });

  it('still lets a clearly better match win its tier', () => {
    // Preferences break ties; they do not overrule the search engine.
    expect(score('https://www.reuters.com/a', 0.99)).toBeGreaterThan(score('https://www.ox.ac.uk/a', 0.2));
  });

  it('keeps the penalty from exceeding the whole bonus stack', () => {
    expect(Math.abs(AFFILIATION_PENALTY)).toBeLessThan(REPUTABLE_BONUS + UK_BONUS + ACADEMIC_BONUS);
  });
});

describe('rankSources', () => {
  const R = (url: string, score: number) => ({ url, title: '', content: 'x', score });

  it('orders by relevance plus bonus and caps the list', () => {
    const out = rankSources(
      [R('https://www.reuters.com/a', 0.9), R('https://www.ox.ac.uk/b', 0.9), R('https://blog.example.com/c', 0.95)],
      { limit: 2 },
    );
    expect(out).toHaveLength(2);
    expect(out[0].domain).toBe('ox.ac.uk');
  });

  it('falls back to the hostname when a result has no title', () => {
    expect(rankSources([R('https://www.ons.gov.uk/a', 0.5)])[0].title).toBe('ons.gov.uk');
  });

  // What makes "search again" mean something. Without it the second look
  // returns the same page one and reads as a broken button.
  it('excludes URLs the author has already seen', () => {
    const out = rankSources([R('https://a.ac.uk/1', 0.9), R('https://b.ac.uk/2', 0.8)], {
      exclude: ['https://a.ac.uk/1'],
    });
    expect(out.map((o) => o.domain)).toEqual(['b.ac.uk']);
  });

  it('excludes the whole domain, not just the one page', () => {
    const out = rankSources([R('https://a.ac.uk/other-page', 0.9), R('https://b.ac.uk/2', 0.8)], {
      exclude: ['https://a.ac.uk/1'],
    });
    expect(out.map((o) => o.domain)).toEqual(['b.ac.uk']);
  });

  it('survives a malformed result rather than throwing', () => {
    const out = rankSources([{ url: '', title: '', content: '', score: 1 }, R('https://a.ac.uk/1', 0.5)]);
    expect(out).toHaveLength(1);
  });
});


// Measured against live Tavily data: the top six for a UK statistics query were
// four ons.gov.uk pages and two gov.uk ones — six rows, two real choices.
describe('rankSources domain diversity', () => {
  const R = (url: string, score: number) => ({ url, title: '', content: 'x', score });

  it('caps one domain at two of the returned slots', () => {
    const out = rankSources(
      [
        R('https://ons.gov.uk/1', 0.99), R('https://ons.gov.uk/2', 0.98),
        R('https://ons.gov.uk/3', 0.97), R('https://ons.gov.uk/4', 0.96),
        R('https://bbc.co.uk/a', 0.5), R('https://ox.ac.uk/b', 0.4),
      ],
      { limit: 4 },
    );
    const ons = out.filter((o) => o.domain === 'ons.gov.uk');
    expect(ons).toHaveLength(2);
    expect(new Set(out.map((o) => o.domain)).size).toBeGreaterThan(1);
  });

  it('keeps each domain its BEST pages, not its first', () => {
    const out = rankSources(
      [R('https://ons.gov.uk/low', 0.1), R('https://ons.gov.uk/high', 0.99), R('https://ons.gov.uk/mid', 0.5)],
      { limit: 2 },
    );
    expect(out.map((o) => o.url)).toEqual(['https://ons.gov.uk/high', 'https://ons.gov.uk/mid']);
  });

  // A thin result set must not be made thinner by the cap.
  it('falls back to one domain when it is genuinely all there is', () => {
    const out = rankSources(
      [R('https://ons.gov.uk/1', 0.9), R('https://ons.gov.uk/2', 0.8), R('https://ons.gov.uk/3', 0.7)],
      { limit: 3 },
    );
    expect(out).toHaveLength(3);
  });

  it('respects an explicit maxPerDomain', () => {
    const out = rankSources(
      [R('https://a.ac.uk/1', 0.9), R('https://a.ac.uk/2', 0.8), R('https://b.ac.uk/1', 0.7)],
      { limit: 3, maxPerDomain: 1 },
    );
    expect(out[0].domain).toBe('a.ac.uk');
    expect(out[1].domain).toBe('b.ac.uk');
  });
});
