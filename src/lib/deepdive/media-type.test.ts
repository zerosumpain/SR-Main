import { describe, it, expect } from 'vitest';
import { classifyMedia, rankSources, mediaMix, type SourceRow } from './media-type';

const kindOf = (url: string, extra: Partial<Parameters<typeof classifyMedia>[0]> = {}) =>
  classifyMedia({ url, ...extra }).kind;

describe('classifyMedia', () => {
  it('reads the file extension before anything else', () => {
    expect(kindOf('https://example.com/data/schools.csv')).toBe('dataset');
    expect(kindOf('https://example.com/deck.pptx')).toBe('slides');
    expect(kindOf('https://example.com/talk.mp4')).toBe('video');
  });

  it('resolves a PDF to a genre rather than calling it "PDF"', () => {
    // The case that prompted this: an academic-host PDF that read as an
    // ordinary link in the source list.
    expect(
      kindOf('https://ash.harvard.edu/wp-content/uploads/2024/02/leasons_from_leading_cdos.pdf', {
        credibilityType: 'academic',
      }),
    ).toBe('paper');
    expect(kindOf('https://arxiv.org/pdf/2401.00001.pdf')).toBe('preprint');
    // A PDF from nowhere in particular is still a document, not a web page.
    expect(kindOf('https://somecouncil.org/uploads/minutes.pdf')).toBe('report');
  });

  it('recognises scholarly hosts', () => {
    expect(kindOf('https://www.nature.com/articles/s41586-024-01234')).toBe('paper');
    expect(kindOf('https://doi.org/10.1038/s41586')).toBe('paper');
    expect(kindOf('https://www.researchgate.net/scientific-contributions/John-Kelly-18623022')).toBe('paper');
    expect(kindOf('https://arxiv.org/abs/2401.00001')).toBe('preprint');
    expect(kindOf('https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1')).toBe('preprint');
  });

  it('separates a LinkedIn profile from a LinkedIn post', () => {
    expect(kindOf('https://uk.linkedin.com/in/johnkelly-uk')).toBe('profile');
    expect(kindOf('https://www.linkedin.com/company/acme')).toBe('profile');
    expect(kindOf('https://www.linkedin.com/posts/johnkelly-uk_ive-been-at-activity-7')).toBe('social');
  });

  it('flags video, data, legal and press material', () => {
    expect(kindOf('https://www.youtube.com/watch?v=JGKv6EAnObM')).toBe('video');
    expect(kindOf('https://www.ons.gov.uk/economy/inflationandpriceindices')).toBe('dataset');
    expect(kindOf('https://www.legislation.gov.uk/ukpga/2018/12')).toBe('legal');
    expect(
      kindOf('https://www.businesswire.com/news/home/20220518005182/en/XIFIN-Appoints'),
    ).toBe('press_release');
    expect(kindOf('https://www.silicon.co.uk/press-release/john-kelly-joins-remote')).toBe('press_release');
  });

  it('reads a dated permalink as a news article', () => {
    // The Register carried 19 of the 32 facts in a real run and was flagged
    // "PAGE": no /news/ segment, host not on any list.
    expect(
      kindOf('https://www.theregister.com/software/2023/07/19/hm-treasury-culls-tech-tools/665172'),
    ).toBe('news');
    // A scholarly host still wins — it is matched earlier, by host.
    expect(kindOf('https://www.nature.com/2024/01/02/articles/x')).toBe('paper');
  });

  it('falls back to the publisher classification only when nothing else spoke', () => {
    expect(kindOf('https://obscure-site.example/page', { credibilityType: 'major_news' })).toBe('news');
    expect(kindOf('https://obscure-site.example/page', { credibilityType: 'wiki' })).toBe('reference');
    expect(kindOf('https://obscure-site.example/page', { credibilityType: 'other' })).toBe('page');
    expect(kindOf('https://obscure-site.example/page')).toBe('page');
  });

  it('reads scholarly phrasing in the title when the host is unknown', () => {
    expect(
      kindOf('https://unknown.example/x', { title: 'Smith et al — outcomes in secondary education' }),
    ).toBe('paper');
    expect(
      kindOf('https://unknown.example/y', { title: 'Annual report 2025' }),
    ).toBe('report');
  });

  it('matches hosts by suffix, never by substring', () => {
    // Both of these shipped wrong: "consultinggroup.com" contains "oup.com"
    // (Oxford University Press), so an investor-relations page was a paper.
    expect(kindOf('https://ir.huronconsultinggroup.com/board-member/john-kelly')).toBe('page');
    expect(kindOf('https://www.wanted.com/jobs/123')).not.toBe('video');
    // The genuine hosts still match, including subdomains.
    expect(kindOf('https://academic.oup.com/journals/x')).toBe('paper');
    expect(kindOf('https://www.youtube.com/watch?v=1')).toBe('video');
  });

  it('does not read a government biography as a research paper', () => {
    // /article/ is the US DoD CMS's URL for a general's biography.
    expect(
      kindOf('https://www.war.gov/About/Biographies/Biography/article/602724/general-john-f-kelly', {
        credibilityType: 'government',
      }),
    ).toBe('page');
  });

  it('survives a malformed URL rather than throwing', () => {
    expect(() => classifyMedia({ url: 'not a url' })).not.toThrow();
    expect(kindOf('not a url')).toBe('page');
  });
});

describe('rankSources', () => {
  const row = (over: Partial<SourceRow>): SourceRow => ({
    id: over.id ?? Math.random().toString(36).slice(2),
    url: 'https://example.com/page',
    title: null,
    domain: 'example.com',
    credibilityScore: 0.5,
    credibilityType: 'other',
    factCount: 0,
    ...over,
  });

  it('puts what actually fed the report above what merely looks trustworthy', () => {
    // The real shape of the John Kelly run: government pages scored 0.9 and
    // produced nothing; a 0.5 trade-press article produced 19 facts.
    const ranked = rankSources([
      row({ id: 'gov', url: 'https://www.gov.uk/government/groups/x', credibilityScore: 0.9, credibilityType: 'government' }),
      row({ id: 'reg', url: 'https://www.theregister.com/2023/07/19/hm-treasury', factCount: 19 }),
    ]);
    expect(ranked[0].id).toBe('reg');
    expect(ranked[0].reasons).toContain('19 facts in the report');
  });

  it('still surfaces substantial material that produced no discrete facts', () => {
    const ranked = rankSources([
      row({ id: 'profile', url: 'https://uk.linkedin.com/in/someone' }),
      row({ id: 'paper', url: 'https://ash.harvard.edu/x.pdf', credibilityType: 'academic', credibilityScore: 0.85 }),
    ]);
    expect(ranked[0].id).toBe('paper');
    expect(ranked[0].keyMaterial).toBe(true);
    expect(ranked.find((r) => r.id === 'profile')!.keyMaterial).toBe(false);
  });

  it('gives every key source a stated reason', () => {
    const ranked = rankSources([
      row({ id: 'a', url: 'https://arxiv.org/abs/1', credibilityScore: 0.8 }),
      row({ id: 'b', url: 'https://news.example/story/1', factCount: 3 }),
    ]);
    for (const r of ranked.filter((x) => x.keyMaterial)) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('does not divide by zero when nothing produced a fact', () => {
    const ranked = rankSources([row({ id: 'a' }), row({ id: 'b' })]);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => Number.isFinite(r.interest))).toBe(true);
  });

  it('handles an empty session', () => {
    expect(rankSources([])).toEqual([]);
    expect(mediaMix([])).toEqual([]);
  });
});

describe('mediaMix', () => {
  it('counts sources and their facts per kind, largest first', () => {
    const ranked = rankSources([
      { id: '1', url: 'https://uk.linkedin.com/in/a', title: null, domain: null, credibilityScore: 0.5, credibilityType: 'social', factCount: 0 },
      { id: '2', url: 'https://uk.linkedin.com/in/b', title: null, domain: null, credibilityScore: 0.5, credibilityType: 'social', factCount: 0 },
      { id: '3', url: 'https://arxiv.org/abs/1', title: null, domain: null, credibilityScore: 0.8, credibilityType: 'academic', factCount: 4 },
    ]);
    const mix = mediaMix(ranked);
    expect(mix[0]).toMatchObject({ kind: 'profile', count: 2, facts: 0 });
    expect(mix.find((m) => m.kind === 'preprint')).toMatchObject({ count: 1, facts: 4 });
  });
});
