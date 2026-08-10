import { describe, it, expect } from 'vitest';
import {
  parseChapterPlan,
  buildRevisionInstruction,
  STUDIO_CRITIC_EXTRA,
  STUDIO_PROPOSER_SYSTEM_PROMPT,
} from './planner';

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

/**
 * SEAM-1 regression.
 *
 * Round 3's revision instruction is the LAST format instruction the model sees
 * before it writes the final plan. It used to be unconditional and to demand
 * "## UI Design / ## Iteration Plan / ### Iteration 1 through 5" — which
 * contradicts the studio proposer's "## Chapter Plan" table. A model that obeys
 * it emits no table: parseChapterPlan returns [], the "### Chapter N:"
 * cross-check compares 0 against 0, agrees, and stays silent, and the build
 * runs with no chapter spine and no gate while the log reads healthy.
 */
describe('round-3 revision instruction', () => {
  const studio = buildRevisionInstruction(true);
  const app = buildRevisionInstruction(false);

  it('asks a studio build for the chapter format, not the app format', () => {
    expect(studio).toContain('## Chapter Plan');
    expect(studio).toContain('## Chapter Detail');
    expect(studio).toContain('## Concept');
    expect(studio).not.toContain('## UI Design\n## Iteration Plan');
    expect(studio).toMatch(/Do NOT emit "## UI Design" or "## Iteration Plan"/);
  });

  it('emits a table the real parser can read back', () => {
    // The literal format block in the instruction is what the model copies. If
    // it ever drifts from the four columns parseChapterPlan expects, the spine
    // silently comes back empty — so parse the instruction itself.
    const filled = studio.replace('| 1 | ... | ... | ... |', '| 1 | What a budget is | roll | total |');
    expect(parseChapterPlan(filled)).toEqual([
      { n: 1, title: 'What a budget is', leverId: 'roll', outcomeId: 'total' },
    ]);
  });

  it('mirrors the studio proposer prompt exactly, section for section', () => {
    // These names are machine-read downstream. A paraphrase in either place
    // breaks the parse, and nothing else in the system would notice.
    for (const section of [
      '## Concept',
      '## Architecture',
      '## Chapter Plan',
      '## Chapter Detail',
      '## Risks & Mitigations',
      '| # | Chapter | Lever id | Outcome id |',
      '|---|---------|----------|------------|',
      '### Chapter 1: [title]',
    ]) {
      expect(STUDIO_PROPOSER_SYSTEM_PROMPT).toContain(section);
      expect(studio).toContain(section);
    }
  });

  it('tells the model the chapter table is mandatory and machine-read', () => {
    expect(studio).toMatch(/MANDATORY/);
    expect(studio).toMatch(/machine-read/i);
  });

  it('asks for one "### Chapter N:" heading per row, which the cross-check counts', () => {
    expect(studio).toMatch(/"### Chapter N: \[title\]" heading under ## Chapter Detail for every row/);
  });

  it('counts the studio critic dimensions correctly', () => {
    // The base critic has 7; STUDIO_CRITIC_EXTRA adds PEDAGOGY (8) and
    // SOURCING (9). "six" was stale.
    expect(studio).toContain('nine dimensions');
    expect(studio).not.toContain('six dimensions');
  });

  it('names the studio-only critic markers so they get addressed', () => {
    for (const marker of ['NO-MODEL:', 'ARBITRARY-ORDER:', 'DECORATIVE-LEVER:', 'UNSOURCED:', 'FALSE-CONFIDENCE:']) {
      expect(studio).toContain(marker);
    }
  });

  it('leaves the non-studio instruction exactly as it was', () => {
    expect(app).toContain('## UI Design');
    expect(app).toContain('## Iteration Plan');
    expect(app).toContain('### Iteration 1 through 5 (same structure as before)');
    expect(app).toContain('six dimensions');
    expect(app).not.toContain('Chapter');
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
