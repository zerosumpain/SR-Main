import { describe, it, expect } from 'vitest';
import {
  coerceScope,
  scopeToSearchOptions,
  scopeAdmits,
  credibilityBonus,
  describeScope,
  OPEN_SCOPE,
} from './scope';

describe('coerceScope', () => {
  it('treats null/undefined as fully open', () => {
    expect(coerceScope(null)).toEqual(OPEN_SCOPE);
    expect(coerceScope(undefined)).toEqual(OPEN_SCOPE);
  });

  it('normalises domains: lowercase, strips scheme, path, port and www', () => {
    const s = coerceScope({ mode: 'bounded', includeDomains: ['HTTPS://WWW.GOV.UK/foo', 'ons.gov.uk:443'] });
    expect(s.includeDomains).toEqual(['gov.uk', 'ons.gov.uk']);
  });

  it('drops blank and non-string domain entries', () => {
    const s = coerceScope({ mode: 'bounded', includeDomains: ['gov.uk', '', '  ', 42, null] });
    expect(s.includeDomains).toEqual(['gov.uk']);
  });

  it('de-duplicates domains after normalisation', () => {
    const s = coerceScope({ mode: 'bounded', includeDomains: ['gov.uk', 'https://gov.uk', 'WWW.GOV.UK'] });
    expect(s.includeDomains).toEqual(['gov.uk']);
  });

  // An exclusive scope with nothing to be exclusive ABOUT is not exclusive, it
  // is a silent full-web search wearing a label. Downgrade rather than lie.
  it('downgrades exclusive with no include list to open', () => {
    expect(coerceScope({ mode: 'exclusive', includeDomains: [] }).mode).toBe('open');
    expect(coerceScope({ mode: 'exclusive' }).mode).toBe('open');
  });

  it('downgrades bounded with no include list to open', () => {
    expect(coerceScope({ mode: 'bounded' }).mode).toBe('open');
  });

  it('keeps exclude domains even in open mode', () => {
    const s = coerceScope({ mode: 'open', excludeDomains: ['facebook.com'] });
    expect(s.mode).toBe('open');
    expect(s.excludeDomains).toEqual(['facebook.com']);
  });

  it('rejects an unknown mode by falling back to open', () => {
    expect(coerceScope({ mode: 'sideways' }).mode).toBe('open');
  });

  it('keeps only http(s) seed urls', () => {
    const s = coerceScope({
      seedUrls: ['https://gov.uk/a', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url'],
    });
    expect(s.seedUrls).toEqual(['https://gov.uk/a']);
  });

  it('clamps recency to a positive integer number of days', () => {
    expect(coerceScope({ recency: { days: 7 } }).recency).toEqual({ days: 7 });
    expect(coerceScope({ recency: { days: 0 } }).recency).toBeNull();
    expect(coerceScope({ recency: { days: -3 } }).recency).toBeNull();
    expect(coerceScope({ recency: { days: 2.7 } }).recency).toEqual({ days: 2 });
  });
});

describe('scopeToSearchOptions', () => {
  it('open scope sends no domain filters', () => {
    const o = scopeToSearchOptions(OPEN_SCOPE);
    expect(o.includeDomains).toBeUndefined();
    expect(o.excludeDomains).toBeUndefined();
  });

  // Bounded PREFERS its domains and ranks others down; it must not hard-filter,
  // or it would be indistinguishable from exclusive.
  it('bounded does not send include_domains — it ranks instead', () => {
    const o = scopeToSearchOptions(coerceScope({ mode: 'bounded', includeDomains: ['gov.uk'] }));
    expect(o.includeDomains).toBeUndefined();
  });

  it('exclusive sends include_domains', () => {
    const o = scopeToSearchOptions(
      coerceScope({ mode: 'exclusive', includeDomains: ['gov.uk', 'ons.gov.uk'] }),
    );
    expect(o.includeDomains).toEqual(['gov.uk', 'ons.gov.uk']);
  });

  it('passes exclusions through in every mode', () => {
    const o = scopeToSearchOptions(coerceScope({ excludeDomains: ['x.com'] }));
    expect(o.excludeDomains).toEqual(['x.com']);
  });

  it('recency switches the search to the news topic with a day window', () => {
    const o = scopeToSearchOptions(coerceScope({ recency: { days: 14 } }));
    expect(o.topic).toBe('news');
    expect(o.days).toBe(14);
  });

  it('no recency leaves topic unset', () => {
    expect(scopeToSearchOptions(OPEN_SCOPE).topic).toBeUndefined();
  });
});

describe('scopeAdmits', () => {
  it('open admits everything', () => {
    expect(scopeAdmits(OPEN_SCOPE, 'https://anything.example/x')).toBe(true);
  });

  it('exclusive admits only listed domains and their subdomains', () => {
    const s = coerceScope({ mode: 'exclusive', includeDomains: ['gov.uk'] });
    expect(scopeAdmits(s, 'https://www.gov.uk/thing')).toBe(true);
    expect(scopeAdmits(s, 'https://data.gov.uk/thing')).toBe(true);
    expect(scopeAdmits(s, 'https://bbc.co.uk/thing')).toBe(false);
  });

  // "notgov.uk" ends with "gov.uk" as a STRING but is a different registrable
  // domain. A naive endsWith would let an attacker-chosen lookalike through.
  it('does not treat a lookalike suffix as a subdomain', () => {
    const s = coerceScope({ mode: 'exclusive', includeDomains: ['gov.uk'] });
    expect(scopeAdmits(s, 'https://notgov.uk/thing')).toBe(false);
  });

  it('bounded admits everything — preference is applied by ranking, not filtering', () => {
    const s = coerceScope({ mode: 'bounded', includeDomains: ['gov.uk'] });
    expect(scopeAdmits(s, 'https://bbc.co.uk/x')).toBe(true);
  });

  it('exclusions win over inclusions in every mode', () => {
    const s = coerceScope({
      mode: 'exclusive',
      includeDomains: ['gov.uk'],
      excludeDomains: ['bad.gov.uk'],
    });
    expect(scopeAdmits(s, 'https://bad.gov.uk/x')).toBe(false);
    expect(scopeAdmits(s, 'https://good.gov.uk/x')).toBe(true);
  });

  it('rejects unparseable urls rather than admitting them', () => {
    const s = coerceScope({ mode: 'exclusive', includeDomains: ['gov.uk'] });
    expect(scopeAdmits(s, 'not a url')).toBe(false);
  });
});

describe('credibilityBonus', () => {
  it('is zero when the scope expresses no preference', () => {
    expect(credibilityBonus(OPEN_SCOPE, 'https://gov.uk/x')).toBe(0);
  });

  it('rewards preferred domains in bounded mode', () => {
    const s = coerceScope({ mode: 'bounded', includeDomains: ['gov.uk'] });
    expect(credibilityBonus(s, 'https://www.gov.uk/x')).toBeGreaterThan(0);
    expect(credibilityBonus(s, 'https://bbc.co.uk/x')).toBe(0);
  });
});

describe('describeScope', () => {
  it('describes an open scope plainly', () => {
    expect(describeScope(OPEN_SCOPE).toLowerCase()).toContain('anywhere');
  });

  it('names the bound domains when exclusive', () => {
    const s = coerceScope({ mode: 'exclusive', includeDomains: ['gov.uk'] });
    expect(describeScope(s)).toContain('gov.uk');
  });
});
