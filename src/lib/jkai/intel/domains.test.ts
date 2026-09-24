import { describe, it, expect } from 'vitest';
import { domainOf, sourcesForDomains, domainCountsFromNodes, INTEL_DOMAINS } from './domains';

describe('domains', () => {
  it('maps every live source to a domain', () => {
    expect(domainOf('email')).toBe('email');
    expect(domainOf('news')).toBe('news');
    expect(domainOf('file')).toBe('documents');
    for (const s of ['chat', 'web', 'pwa']) expect(domainOf(s)).toBe('chat');
    expect(domainOf('whatsapp')).toBe('chat');
    for (const s of ['research', 'daydream', 'notebook']) expect(domainOf(s)).toBe('research');
    expect(domainOf('workflow')).toBe('automations');
    expect(domainOf('home')).toBe('home');
  });

  it('facets follow their base source', () => {
    expect(domainOf('email:bulk')).toBe('email');
    expect(domainOf('email@linkedin.com')).toBe('email');
  });

  it('an unknown source is visible as other, not dropped', () => {
    expect(domainOf('telegram')).toBe('other');
  });

  it('expands domains to their sources', () => {
    expect(sourcesForDomains(['research']).sort()).toEqual(['daydream', 'notebook', 'research']);
    expect(sourcesForDomains(['email', 'news']).sort()).toEqual(['email', 'news']);
    expect(sourcesForDomains([])).toEqual([]);
  });

  it('counts every domain, facets excluded, in table order', () => {
    const counts = domainCountsFromNodes([
      { sources: ['email', 'email:bulk', 'email@x.com'] },
      { sources: ['chat'] },
      { sources: ['web'] },
    ]);
    expect(counts.map((c) => c.id)).toEqual(INTEL_DOMAINS.map((d) => d.id));
    expect(counts.find((c) => c.id === 'email')?.count).toBe(1);
    expect(counts.find((c) => c.id === 'chat')?.count).toBe(2);
    expect(counts.find((c) => c.id === 'home')?.count).toBe(0);
  });

  it('counts an entity once per domain, however many of its sources fall in it', () => {
    // The bug this replaces: summing per-source counts put an entity with
    // research AND daydream under Research twice.
    const counts = domainCountsFromNodes([{ sources: ['research', 'daydream', 'notebook'] }]);
    expect(counts.find((c) => c.id === 'research')?.count).toBe(1);
  });

  it('counts an entity under every domain it touches', () => {
    const counts = domainCountsFromNodes([{ sources: ['email', 'file'] }]);
    expect(counts.find((c) => c.id === 'email')?.count).toBe(1);
    expect(counts.find((c) => c.id === 'documents')?.count).toBe(1);
  });

  it('ignores facets, so a facet-only entity counts nowhere — not even other', () => {
    const counts = domainCountsFromNodes([{ sources: ['email:bulk', 'email@x.com'] }]);
    expect(counts.every((c) => c.count === 0)).toBe(true);
  });

  it('adds a pre-aggregated group by its count', () => {
    const counts = domainCountsFromNodes([
      { sources: ['research'], count: 5 },
      { sources: ['daydream'], count: 2 },
      { sources: ['email'] },
    ]);
    expect(counts.find((c) => c.id === 'research')?.count).toBe(7);
    expect(counts.find((c) => c.id === 'email')?.count).toBe(1);
  });

  it('puts an unknown source under other', () => {
    const counts = domainCountsFromNodes([{ sources: ['telegram'] }, { sources: [] }]);
    expect(counts.find((c) => c.id === 'other')?.count).toBe(1);
  });
});
