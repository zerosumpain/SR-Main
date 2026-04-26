import { describe, it, expect } from 'vitest';
import { parsePlanMilestones } from '$lib/jkai/plan-parse';

describe('parsePlanMilestones', () => {
  it('extracts milestones from "### Iteration N:" headers + "- Milestone:" lines', () => {
    const md = `## Iteration Plan\n\n### Iteration 1: Auth flow\n- Goal: ship\n- Milestone: user can sign in\n\n### Iteration 2: Dashboard\n- Goal: render\n- Milestone: dashboard loads with live data`;
    const result = parsePlanMilestones(md);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'iter-1', title: 'user can sign in', done: false, iter: 1 });
    expect(result[1]).toMatchObject({ id: 'iter-2', title: 'dashboard loads with live data', done: false, iter: 2 });
  });

  it('returns [] for empty/null input', () => {
    expect(parsePlanMilestones('')).toEqual([]);
    expect(parsePlanMilestones(null)).toEqual([]);
    expect(parsePlanMilestones(undefined)).toEqual([]);
  });

  it('skips iteration sections that have no milestone line', () => {
    const md = `### Iteration 1: x\n- Goal: y\n### Iteration 2: w\n- Milestone: m`;
    expect(parsePlanMilestones(md)).toEqual([
      { id: 'iter-2', title: 'm', done: false, iter: 2 },
    ]);
  });

  it('handles iteration headers with the trailing colon and a title', () => {
    const md = `### Iteration 3: Some title here\n- Milestone: thing happens`;
    expect(parsePlanMilestones(md)).toEqual([
      { id: 'iter-3', title: 'thing happens', done: false, iter: 3 },
    ]);
  });
});
