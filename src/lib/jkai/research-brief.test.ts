import { describe, it, expect } from 'vitest';
import { isBriefUsable, formatBriefForPrompt, RESEARCH_DEADLINE_MS, type ResearchBrief } from './research-brief';

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
