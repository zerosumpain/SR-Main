import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import {
  isBriefUsable,
  formatBriefForPrompt,
  mapHitsToFacts,
  distinctHostCount,
  evidenceIsSufficient,
  RESEARCH_DEADLINE_MS,
  RESEARCH_MODES,
  type ResearchBrief,
} from './research-brief';

function brief(over: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    topic: 'school funding',
    facts: Array.from({ length: 9 }, (_, i) => ({
      claim: `fact ${i}`,
      sourceUrl: `https://example.gov.uk/${i}`,
    })),
    concepts: [{ name: 'Basic entitlement', whyHard: 'It is per-pupil but not per-pupil-equal.' }],
    causalMap: [{ from: 'roll', to: 'budget', relationship: 'scales' }],
    liveData: [{ name: 'NFF tables', url: 'https://gov.uk/x', what: 'per-school allocations' }],
    misconceptions: ['People assume funding follows need linearly.'],
    gaps: ['No public figure for in-year adjustments.'],
    sessionId: 'rs_1',
    ...over,
  };
}

describe('isBriefUsable', () => {
  it('accepts a brief with enough sourced facts', () => {
    expect(isBriefUsable(brief()).ok).toBe(true);
  });

  it('refuses a brief with fewer than 8 facts rather than letting the planner invent a syllabus', () => {
    const r = isBriefUsable(brief({ facts: brief().facts.slice(0, 3) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/3 sourced facts/);
  });

  it('refuses when gaps outnumber facts', () => {
    const r = isBriefUsable(brief({ gaps: Array.from({ length: 12 }, (_, i) => `gap ${i}`) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/more gaps than facts/);
  });

  it('refuses a fact with no source url — provenance is the whole point', () => {
    const f = brief().facts;
    f[0] = { claim: 'unsourced', sourceUrl: '' };
    const r = isBriefUsable(brief({ facts: f }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/without a source/);
  });

  it('refuses a brief with no causal map — sim.js has nothing to model', () => {
    const r = isBriefUsable(brief({ causalMap: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/causal/);
  });

  it('accepts a brief with exactly 8 facts — the boundary, not just above it', () => {
    const r = isBriefUsable(brief({ facts: brief().facts.slice(0, 8) }));
    expect(r.ok).toBe(true);
  });

  it('accepts a brief where gaps equal facts in count — only strictly more fails', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `gap ${i}`);
    const r = isBriefUsable(brief({ gaps: nine }));
    expect(r.ok).toBe(true);
  });

  it('refuses a brief drawn from too few distinct sources, even if every fact is individually sourced', () => {
    const facts = Array.from({ length: 8 }, (_, i) => ({
      claim: `fact ${i}`,
      sourceUrl: i % 2 === 0 ? 'https://example.gov.uk/a' : 'https://example.gov.uk/b',
    }));
    const r = isBriefUsable(brief({ facts }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/research base/);
  });
});

describe('formatBriefForPrompt', () => {
  it('renders every fact with its url so a claim can be traced', () => {
    const out = formatBriefForPrompt(brief());
    expect(out).toContain('https://example.gov.uk/0');
    expect(out).toContain('## FACTS');
    expect(out).toContain('## GAPS');
  });

  it('states plainly that gaps must not be smoothed over', () => {
    expect(formatBriefForPrompt(brief())).toMatch(/do not invent/i);
  });
});

describe('research deadline', () => {
  // The first pick was 20 minutes and it killed the first real studio build at
  // 20m00s, while its session was still gathering (353 facts, 44 sources).
  // Measured across the 17 completed sessions in production on 2026-08-10:
  // mean 29.8m, p90 67.4m, max 82.8m. Anything at or below the observed max
  // fails a meaningful share of real topics, so pin above it.
  it('clears the longest real research session ever observed', () => {
    expect(RESEARCH_DEADLINE_MS).toBeGreaterThanOrEqual(83 * 60 * 1000);
  });

  // reapStaleBuilds abandons a running build quiet for 30 minutes. A deadline
  // past that is only safe because the poll loop writes heartbeatAt.
  it('exceeds the 30-minute reaper cutoff, which is why the poll must heartbeat', () => {
    expect(RESEARCH_DEADLINE_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});

function hit(over: Partial<{ factId: string; passage: string; confidence: number; sourceUrl: string | null; sourceTitle: string | null }> = {}) {
  return {
    factId: 'f1',
    passage: 'A claim about school funding.',
    confidence: 0.8,
    sourceUrl: 'https://a.gov.uk/one',
    sourceTitle: 'A page',
    ...over,
  };
}

describe('mapHitsToFacts', () => {
  it('keeps only hits with a usable http(s) source', () => {
    const out = mapHitsToFacts([
      hit(),
      hit({ factId: 'f2', sourceUrl: null }),
      hit({ factId: 'f3', sourceUrl: 'javascript:alert(1)' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['f1']);
  });

  it('drops an empty passage rather than emitting a blank fact', () => {
    expect(mapHitsToFacts([hit({ passage: '   ' })])).toEqual([]);
  });

  // Two sessions researching the same area routinely extract the same claim
  // from the same page. Left in, the brief looks well-sourced while repeating
  // itself, and the host-diversity check is fooled too.
  it('dedupes the same claim from the same url across sessions', () => {
    const out = mapHitsToFacts([
      hit({ factId: 'a' }),
      hit({ factId: 'b' }),
      hit({ factId: 'c', passage: 'A CLAIM about school funding.' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps the same claim when it came from a different source', () => {
    const out = mapHitsToFacts([hit({ factId: 'a' }), hit({ factId: 'b', sourceUrl: 'https://b.gov.uk/two' })]);
    expect(out).toHaveLength(2);
  });

  it('respects the cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => hit({ factId: `f${i}`, sourceUrl: `https://x.gov.uk/${i}` }));
    expect(mapHitsToFacts(many)).toHaveLength(15);
  });
});

describe('distinctHostCount', () => {
  it('counts hosts, not urls', () => {
    expect(distinctHostCount([
      { url: 'https://a.gov.uk/one' },
      { url: 'https://a.gov.uk/two' },
      { url: 'https://b.gov.uk/one' },
    ])).toBe(2);
  });

  it('ignores nulls and malformed urls', () => {
    expect(distinctHostCount([{ url: null }, { url: 'not a url' }, { url: 'https://a.gov.uk/x' }])).toBe(1);
  });
});

describe('evidenceIsSufficient', () => {
  const rows = (n: number, hosts: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`, content: 'c', confidence: 0.5,
      url: `https://h${i % hosts}.gov.uk/${i}`, title: null,
    }));

  it('accepts evidence clearing both bars', () => {
    expect(evidenceIsSufficient(rows(8, 3))).toBe(true);
  });

  it('rejects too few facts even from many hosts', () => {
    expect(evidenceIsSufficient(rows(7, 7))).toBe(false);
  });

  // 15 facts all scraped off one page is technically sourced, not researched.
  it('rejects plenty of facts from too few hosts', () => {
    expect(evidenceIsSufficient(rows(15, 2))).toBe(false);
  });
});

describe('research modes', () => {
  it('exposes exactly the three modes', () => {
    expect([...RESEARCH_MODES].sort()).toEqual(['extend', 'fresh', 'reuse']);
  });

  // schema.ts deliberately repeats these literals rather than importing from
  // $lib/jkai (that direction is circular). Repetition without a check is how
  // the two drift, and drizzle's enum is a TS hint with no CHECK constraint
  // behind it — so a drifted value fails at runtime, not at push.
  it('matches the enum on the jkai_builds.research_mode column', async () => {
    const schemaSrc = await readFile('src/lib/db/schema.ts', 'utf-8');
    const m = schemaSrc.match(/text\('research_mode',\s*\{\s*enum:\s*\[([^\]]+)\]/);
    expect(m, 'research_mode column not found in schema.ts').toBeTruthy();
    const declared = (m![1].match(/'([^']+)'/g) ?? []).map((q) => q.replace(/'/g, '')).sort();
    expect(declared).toEqual([...RESEARCH_MODES].sort());
  });
});
