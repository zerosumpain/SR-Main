import { describe, it, expect } from 'vitest';
import {
  designSectionOf,
  parseShotsOutput,
  parseReviewFindings,
  describeDesignReview,
  readKitRubric,
  reviewPrompt,
} from './design-review';

// The contract every harness in this builder shares: a harness that could not
// run reports `ran: false`, never `passed: false`. A broken harness reporting a
// failing app blocks good work and teaches the model to route around the tool.
describe('parseShotsOutput', () => {
  const shot = { n: 1, title: 'Ch', path: '/chapter-1/', mime: 'image/jpeg', base64: 'AAAA' };

  it('reads a well-formed run', () => {
    const out = parseShotsOutput(JSON.stringify({ ran: true, shots: [shot], skipped: [] }), '');
    expect(out.ran).toBe(true);
    if (out.ran) expect(out.shots).toHaveLength(1);
  });

  it('tolerates a leading banner before the JSON', () => {
    const out = parseShotsOutput(`warning: something\n${JSON.stringify({ ran: true, shots: [shot] })}`, '');
    expect(out.ran).toBe(true);
  });

  it('reports empty stdout as a skip, carrying stderr as the reason', () => {
    const out = parseShotsOutput('', 'Error: chromium is missing');
    expect(out.ran).toBe(false);
    if (!out.ran) expect(out.reason).toContain('chromium');
  });

  it('reports unparseable output as a skip, never a pass', () => {
    expect(parseShotsOutput('not json at all', '').ran).toBe(false);
  });

  // A truncated exec buffer is the realistic failure here — the shots script
  // caps its own payload for exactly that reason, but a JSON line cut mid-image
  // must still land as a skip rather than as "no findings".
  it('reports a truncated JSON line as a skip', () => {
    const truncated = JSON.stringify({ ran: true, shots: [shot] }).slice(0, 40);
    expect(parseShotsOutput(truncated, '').ran).toBe(false);
  });

  it('treats a run that produced no usable image as a skip', () => {
    const out = parseShotsOutput(JSON.stringify({ ran: true, shots: [], skipped: [{ n: 1, reason: '404' }] }), '');
    expect(out.ran).toBe(false);
  });

  it('drops a shot carrying no image data rather than sending an empty data URI', () => {
    const out = parseShotsOutput(
      JSON.stringify({ ran: true, shots: [shot, { ...shot, n: 2, base64: '' }] }),
      '',
    );
    expect(out.ran).toBe(true);
    if (out.ran) expect(out.shots.map((s) => s.n)).toEqual([1]);
  });
});

describe('parseReviewFindings', () => {
  const good = {
    chapter: 2,
    rule: 'bespoke-layout',
    message: 'Beat 3 uses a hand-rolled two-column grid.',
    evidence: 'Two equal columns of body prose either side of the figure.',
    remedy: 'Use template T2 from templates.json.',
  };

  it('reads a bare JSON object', () => {
    expect(parseReviewFindings(JSON.stringify({ findings: [good] }))).toHaveLength(1);
  });

  it('reads it back out of a ```json fence', () => {
    const text = '```json\n' + JSON.stringify({ findings: [good] }) + '\n```';
    expect(parseReviewFindings(text)).toHaveLength(1);
  });

  it('reads it out of surrounding prose', () => {
    const text = `Here is my review:\n${JSON.stringify({ findings: [good] })}\nHope that helps.`;
    expect(parseReviewFindings(text)).toHaveLength(1);
  });

  it('returns an empty list for a clean page, which is a PASS not a skip', () => {
    expect(parseReviewFindings(JSON.stringify({ findings: [] }))).toEqual([]);
  });

  it('returns null when nothing parseable came back, so the caller reports a skip', () => {
    expect(parseReviewFindings('The page looks lovely to me.')).toBeNull();
    expect(parseReviewFindings('')).toBeNull();
    expect(parseReviewFindings('{ findings: [oops }')).toBeNull();
  });

  // The fabrication guard. A vision model asked to judge against a written
  // rubric will report rules it cannot see from a screenshot in the same
  // confident register as the ones it can. A finding that names no visible
  // evidence is that case, and it costs the build an iteration chasing nothing.
  it('drops a finding that names no evidence', () => {
    const out = parseReviewFindings(JSON.stringify({ findings: [{ ...good, evidence: '  ' }] }));
    expect(out).toEqual([]);
  });

  // An unfixable finding repeated three times kills a finished build — the
  // design_lint_loop incident of 2026-08-09.
  it('drops a finding that names no remedy', () => {
    const out = parseReviewFindings(JSON.stringify({ findings: [{ ...good, remedy: '' }] }));
    expect(out).toEqual([]);
  });

  it('caps the list so one iteration cannot be handed a rewrite request', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...good, chapter: i }));
    expect(parseReviewFindings(JSON.stringify({ findings: many }))!.length).toBeLessThanOrEqual(8);
  });

  it('survives junk entries mixed in with real ones', () => {
    const out = parseReviewFindings(JSON.stringify({ findings: [null, 'nope', good] }));
    expect(out).toHaveLength(1);
  });
});

describe('describeDesignReview', () => {
  it('says which model judged it, so a bad review can be traced to a bad pick', () => {
    const text = describeDesignReview({
      ran: true,
      passed: true,
      findings: [],
      reviewed: [1, 2],
      modelId: 'anthropic/claude-sonnet-4.5',
    });
    expect(text).toContain('anthropic/claude-sonnet-4.5');
    expect(text).toContain('passed');
  });

  it('renders each finding with its evidence and its remedy', () => {
    const text = describeDesignReview({
      ran: true,
      passed: false,
      findings: [
        {
          chapter: 2,
          rule: 'palette-weighting',
          message: 'Petrol is carrying the primary series.',
          evidence: 'The lead bar chart is petrol; orange appears only in the legend.',
          remedy: 'Orange is live/current/primary; petrol is the second series.',
        },
      ],
      reviewed: [2],
      modelId: 'm',
    });
    expect(text).toContain('palette-weighting');
    expect(text).toContain('seen:');
    expect(text).toContain('→');
  });

  it('names a skip as a skip', () => {
    expect(describeDesignReview({ ran: false, reason: 'chromium missing' })).toContain('skipped');
  });
});

// The `\Z` trap. The obvious regex for "everything under ## Design until the
// next ##" ends `(?=^##\s|\Z)`, and `\Z` is not a JavaScript anchor — it
// matches a literal "Z". That pattern passes against the real CHECKLIST.md only
// because Design happens to be followed by Instruments, so the real file cannot
// exercise the case that breaks.
describe('designSectionOf', () => {
  it('takes Design and stops at the next heading', () => {
    const out = designSectionOf('## Argument\n- a\n\n## Design\n- d1\n- d2\n\n## Honesty\n- h');
    expect(out).toContain('- d1');
    expect(out).toContain('- d2');
    expect(out).not.toContain('- a');
    expect(out).not.toContain('- h');
  });

  it('takes Design when it is the LAST section', () => {
    const out = designSectionOf('## Argument\n- a\n\n## Design\n- d1\n- d2\n');
    expect(out).toContain('- d1');
    expect(out).toContain('- d2');
    expect(out).not.toContain('- a');
  });

  it('falls back to the whole checklist when there is no Design heading', () => {
    const whole = '## Argument\n- a\n\n## Honesty\n- h';
    expect(designSectionOf(whole)).toBe(whole);
  });
});

// The rubric is read from the kit on disk rather than restated in TypeScript,
// so that it cannot drift from the ship gate the kit actually documents. If the
// kit moves or the Design heading is renamed, this fails here rather than
// silently degrading every review into generic taste.
describe('readKitRubric', () => {
  it('finds the kit and extracts only the Design section', async () => {
    const rubric = await readKitRubric(process.cwd());
    expect(rubric).not.toBeNull();
    expect(rubric!.designChecklist).toMatch(/^##\s*Design/);
    // The sections either side must NOT come along: they are real rules that
    // are not decidable from a picture, and handing them to a reviewer that can
    // only see pixels is an invitation to invent.
    expect(rubric!.designChecklist).not.toContain('## Instruments');
    expect(rubric!.designChecklist).not.toContain('## Honesty');
    expect(rubric!.tokens).toContain('--ex-');
  });

  it('puts the rubric and the tokens into the prompt it builds', async () => {
    const rubric = await readKitRubric(process.cwd());
    const prompt = reviewPrompt(rubric!);
    expect(prompt).toContain(rubric!.designChecklist);
    expect(prompt).toContain('--ex-bg');
    // The linter already owns these three, and re-reporting them wastes the
    // review's small findings budget on things a regex settles for free.
    expect(prompt).toContain('do not report those');
  });

  it('returns null when the kit is not there, so the caller skips rather than guesses', async () => {
    expect(await readKitRubric('/nonexistent-repo-root')).toBeNull();
  });
});
