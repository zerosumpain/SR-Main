import { describe, it, expect } from 'vitest';
import { parseChapterPlan, STUDIO_CRITIC_EXTRA } from './planner';

describe('parseChapterPlan', () => {
  it('reads the chapter table the studio proposer is told to emit', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | What a school budget is | roll | total |
| 2 | Where deprivation money goes | fsm | uplift |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' },
      { n: 2, title: 'Where deprivation money goes', leverId: 'fsm', outcomeId: 'uplift' },
    ]);
  });

  it('returns an empty array when no table is present rather than throwing', () => {
    expect(parseChapterPlan('## Architecture\nsome prose')).toEqual([]);
  });

  it('skips a malformed row instead of dropping the whole plan', () => {
    const md = `
| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | Good row | a | b |
| x | Bad row |
| 3 | Also good | c | d |
`;
    expect(parseChapterPlan(md).map((c) => c.n)).toEqual([1, 3]);
  });
});

describe('studio critic', () => {
  it('adds a pedagogy dimension', () => {
    expect(STUDIO_CRITIC_EXTRA).toContain('PEDAGOGY');
    expect(STUDIO_CRITIC_EXTRA).toContain('NO-MODEL:');
    expect(STUDIO_CRITIC_EXTRA).toContain('ARBITRARY-ORDER:');
  });

  it('adds a sourcing dimension', () => {
    expect(STUDIO_CRITIC_EXTRA).toContain('SOURCING');
    expect(STUDIO_CRITIC_EXTRA).toContain('UNSOURCED:');
  });
});
