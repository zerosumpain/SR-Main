import { describe, it, expect } from 'vitest';
import { suggestQuestions, buildAskPrompt, askUrl, type AskContext } from './ask-questions';

const ctx = (over: Partial<AskContext> = {}): AskContext => ({
  sessionId: 'sess-123',
  topic: 'The UK Office for National Statistics',
  topEntities: ['Office for National Statistics'],
  report: {},
  ...over,
});

describe('suggestQuestions', () => {
  it('always offers a judgement and a weakness question, even for a bare report', () => {
    const qs = suggestQuestions(ctx({ report: {}, topEntities: [] }));
    expect(qs.map((q) => q.id)).toEqual(expect.arrayContaining(['verdict', 'holes']));
    expect(qs.length).toBeGreaterThanOrEqual(2);
  });

  it('every suggestion is a real question, not a fragment to finish', () => {
    // The whole complaint: the old button handed over `About my research on "X" — `.
    for (const q of suggestQuestions(ctx({ report: { knowledge_gaps: [{ gap: 'no 2026 data' }] } }))) {
      expect(q.question.length).toBeGreaterThan(40);
      expect(q.question.trim()).not.toMatch(/[—-]$/);
      // Every question must be answerable against the session it came from.
      expect(q.question).toContain('sess-123');
    }
  });

  it('builds questions out of what the report actually raised', () => {
    const qs = suggestQuestions(
      ctx({
        report: {
          contradictions_map: [{ tension: 'One source says 2021, another says 2022' }],
          suggested_followups: [{ question: 'What is the current headcount?', context: 'not covered' }],
          knowledge_gaps: [{ gap: 'minor thing' }, { gap: 'the big one', severity: 'high' }],
          hypotheses: [{ hypothesis: 'The reorganisation caused the delay' }],
        },
      }),
    );
    const ids = qs.map((q) => q.id);
    expect(ids).toContain('tension-0');
    expect(ids).toContain('followup-0');
    expect(ids).toContain('hypothesis');
    // The HIGH severity gap wins, not merely the first one in the list.
    expect(qs.find((q) => q.id === 'gap')!.question).toContain('the big one');
  });

  it('keeps labels short enough to read as a chip', () => {
    const qs = suggestQuestions(
      ctx({
        report: {
          suggested_followups: [{ question: 'x'.repeat(300) }],
        },
      }),
    );
    for (const q of qs) expect(q.label.length).toBeLessThanOrEqual(60);
  });

  it('caps the menu', () => {
    const qs = suggestQuestions(
      ctx({
        report: {
          contradictions_map: [{ tension: 'a' }, { tension: 'b' }, { tension: 'c' }],
          suggested_followups: [{ question: 'a' }, { question: 'b' }, { question: 'c' }],
          knowledge_gaps: [{ gap: 'a' }, { gap: 'b' }],
          hypotheses: [{ hypothesis: 'a' }, { hypothesis: 'b' }],
        },
      }),
    );
    expect(qs.length).toBeLessThanOrEqual(8);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
  });

  it('does not invent an entity question when there are no entities', () => {
    expect(suggestQuestions(ctx({ topEntities: [] })).some((q) => q.id === 'entity')).toBe(false);
  });
});

describe('buildAskPrompt', () => {
  it('names the tools and the session so the answer comes from the run', () => {
    const p = buildAskPrompt('What did this establish?', ctx());
    expect(p).toContain('research_query');
    expect(p).toContain('sess-123');
    expect(p).toContain('The UK Office for National Statistics');
  });

  it('does not staple the session reference on twice', () => {
    const already = suggestQuestions(ctx())[0].question;
    const p = buildAskPrompt(already, ctx());
    expect(p).not.toContain('This is about my research session');
  });

  it('anchors a free-typed question that does not mention the session', () => {
    const p = buildAskPrompt('Who funds them?', ctx());
    expect(p).toContain('This is about my research session sess-123');
  });
});

describe('askUrl', () => {
  it('forces a new thread and actually sends', () => {
    const url = askUrl('Who funds them?', ctx());
    expect(url).toContain('new=1');
    expect(url).toContain('send=1');
    expect(url.startsWith('/jkai?')).toBe(true);
  });

  it('encodes the prompt so quotes and newlines survive the URL', () => {
    const url = askUrl('Why "this" and\nnot that?', ctx());
    expect(url).not.toContain('\n');
    const q = new URLSearchParams(url.split('?')[1]).get('q');
    expect(q).toContain('Why "this" and\nnot that?');
  });
});
