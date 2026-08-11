import { describe, it, expect } from 'vitest';
import {
  parseChapterPlan,
  normaliseSpineId,
  normaliseVocab,
  CHAPTER_FORMS,
  CONTROL_KINDS,
  buildRevisionInstruction,
  STUDIO_CRITIC_EXTRA,
  STUDIO_PROPOSER_SYSTEM_PROMPT,
} from './planner';

describe('parseChapterPlan', () => {
  it('reads the chapter table the studio proposer is told to emit', () => {
    const md = `
## Chapter Plan

| # | Chapter | Form | Control | Lever id | Outcome id |
|---|---------|------|---------|----------|------------|
| 1 | What a school budget is | open | choice | roll | total |
| 2 | Where deprivation money goes | compare | slider | fsm | uplift |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'What a school budget is', form: 'open', control: 'choice', leverId: 'roll', outcomeId: 'total' },
      { n: 2, title: 'Where deprivation money goes', form: 'compare', control: 'slider', leverId: 'fsm', outcomeId: 'uplift' },
    ]);
  });

  it('returns an empty array when no table is present rather than throwing', () => {
    expect(parseChapterPlan('## Architecture\nsome prose')).toEqual([]);
  });

  // The regression that cost build 85dac418 every one of its no-model
  // findings. This is that build's real spine, copied out of production.
  it('strips the code-span backticks models put round ids', () => {
    const md = `
## Chapter Plan

| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | The Record Room | \`matchclaim\` | \`claimscope\` |
| 2 | Associations Without Assumptions | \`placeassociation\` | \`associationboundary\` |
`;
    expect(parseChapterPlan(md)).toEqual([
      { n: 1, title: 'The Record Room', form: 'question', control: 'choice', leverId: 'matchclaim', outcomeId: 'claimscope' },
      {
        n: 2,
        title: 'Associations Without Assumptions',
        form: 'question',
        control: 'choice',
        leverId: 'placeassociation',
        outcomeId: 'associationboundary',
      },
    ]);
  });

  it('rejects a row whose id cannot survive into an attribute selector', () => {
    const md = `
| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | Fine | roll | total |
| 2 | Broken | 123 | ok |
`;
    const stats = { rejected: 0 };
    expect(parseChapterPlan(md, stats).map((c) => c.n)).toEqual([1]);
    expect(stats.rejected).toBe(1);
  });
});

describe('normaliseSpineId', () => {
  it.each([
    ['`matchclaim`', 'matchclaim'],
    ['**roll**', 'roll'],
    ['Match Claim', 'match-claim'],
    ['matchClaim', 'matchclaim'],
    ['fsm_uplift', 'fsm_uplift'],
    ['a', 'a'],
  ])('%s -> %s', (raw, want) => {
    expect(normaliseSpineId(raw)).toBe(want);
  });

  // Null means "reject the row". Coercing these to something plausible would
  // reintroduce the original bug in a new costume: an id the gate looks for
  // and the agent never writes.
  it.each([['123'], [''], ['   '], ['`` ``'], ['—']])('rejects %s', (raw) => {
    expect(normaliseSpineId(raw)).toBeNull();
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
      { n: 1, title: 'What a school budget is', form: 'question', control: 'choice', leverId: 'roll', outcomeId: 'total' },
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
      { n: 1, title: 'What a school budget is', form: 'question', control: 'choice', leverId: 'roll', outcomeId: 'total' },
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
    // it ever drifts from the six columns parseChapterPlan expects, the spine
    // silently comes back empty — so parse the instruction itself.
    const filled = studio.replace(
      '| 1 | ... | ... | ... | ... | ... |',
      '| 1 | What a budget is | walk | step | roll | total |',
    );
    expect(parseChapterPlan(filled)).toEqual([
      { n: 1, title: 'What a budget is', form: 'walk', control: 'step', leverId: 'roll', outcomeId: 'total' },
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
      '| # | Chapter | Form | Control | Lever id | Outcome id |',
      '|---|---------|------|---------|----------|------------|',
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

// The plan had no word for HOW a chapter is told, so every chapter of every
// build came out as `article > h2 > h2` and every lever was a range slider.
describe('the chapter spine carries editorial decisions', () => {
  const wide = `
## Chapter Plan

| # | Chapter | Form | Control | Lever id | Outcome id |
|---|---------|------|---------|----------|------------|
| 1 | The record room | open | choice | source | scope |
| 2 | How a claim moves | walk | step | stage | status |
`;

  it('reads form and control from the six-column table', () => {
    expect(parseChapterPlan(wide)).toEqual([
      { n: 1, title: 'The record room', form: 'open', control: 'choice', leverId: 'source', outcomeId: 'scope' },
      { n: 2, title: 'How a claim moves', form: 'walk', control: 'step', leverId: 'stage', outcomeId: 'status' },
    ]);
  });

  // A build planned before forms existed, or a model that drops the columns,
  // must still yield a working spine rather than nothing.
  it('still parses the old four-column table, with defaults', () => {
    const narrow = `
| # | Chapter | Lever id | Outcome id |
|---|---------|----------|------------|
| 1 | Old shape | roll | total |
`;
    expect(parseChapterPlan(narrow)).toEqual([
      { n: 1, title: 'Old shape', form: 'question', control: 'choice', leverId: 'roll', outcomeId: 'total' },
    ]);
  });

  // choice, not slider: the house style this copies uses buttons over sliders
  // 43 to 10, and a slider is only honest for a continuous quantity.
  it('defaults an unrecognised control to choice, not slider', () => {
    const odd = `
| # | Chapter | Form | Control | Lever id | Outcome id |
|---|---------|------|---------|----------|------------|
| 1 | Odd | interpretive-dance | vibes | a | b |
`;
    const [row] = parseChapterPlan(odd);
    expect(row.control).toBe('choice');
    expect(row.form).toBe('question');
  });

  it('strips backticks from form and control the same as from ids', () => {
    const ticked = `
| # | Chapter | Form | Control | Lever id | Outcome id |
|---|---------|------|---------|----------|------------|
| 1 | T | \`walk\` | \`toggle\` | a | b |
`;
    const [row] = parseChapterPlan(ticked);
    expect(row.form).toBe('walk');
    expect(row.control).toBe('toggle');
  });
});

describe('normaliseVocab', () => {
  it('accepts a known value in any case', () => {
    expect(normaliseVocab('WALK', CHAPTER_FORMS)).toBe('walk');
    expect(normaliseVocab(' Toggle ', CONTROL_KINDS)).toBe('toggle');
  });

  it('returns null for anything not in the vocabulary', () => {
    expect(normaliseVocab('carousel', CHAPTER_FORMS)).toBeNull();
    expect(normaliseVocab('', CONTROL_KINDS)).toBeNull();
  });
});
