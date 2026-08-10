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

  it('ignores a second table outside the Chapter Plan section (e.g. Risks & Mitigations)', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | What a school budget is | roll | total |

## Risks & Mitigations

| # | Risk | Mitigation | Owner |
|---|------|------------|-------|
| 2 | Data goes stale | Cache refresh | eng |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' },
    ]);
  });

  it('strips bold markdown from cells so ** does not corrupt the number or leak into the title', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| **1** | **What a school budget is** | roll | total |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' },
    ]);
  });

  it('drops a row with an empty lever id and reports it via the stats out-param', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | Good chapter | roll | total |
| 2 | Missing lever |  | uplift |
| 3 | Also good | fsm | share |
`;
    const stats = { rejected: 0 };
    const chapters = parseChapterPlan(md, stats);
    expect(chapters.map((c) => c.n)).toEqual([1, 3]);
    expect(stats.rejected).toBe(1);
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
