import { describe, it, expect } from 'vitest';
import { isBriefUsable, formatBriefForPrompt, type ResearchBrief } from './research-brief';

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
