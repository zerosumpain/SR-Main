// interview.test.ts — the interview model must stay internally consistent: cumulative
// question tiers, section routing that resolves to real templates, skeletons whose
// word budgets land inside the promised page bands, and a digest with no leaks.

import { describe, it, expect } from 'vitest';
import {
  INTERVIEW_QUESTIONS,
  QUESTION_BY_ID,
  questionsForDepth,
  SKELETONS,
  wordBudget,
  PAGE_WORDS,
  digestAnswer,
  digestAnswers,
  digestForSection,
  DEPTHS,
  LENGTHS,
  type InterviewAnswer,
} from '../interview';
import { TEMPLATE_BY_ID } from '../templates';

describe('question bank', () => {
  it('has unique ids and valid shapes', () => {
    const ids = INTERVIEW_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of INTERVIEW_QUESTIONS) {
      expect([1, 2, 3]).toContain(q.tier);
      expect(q.text.length).toBeGreaterThan(10);
      expect(q.topic.length).toBeGreaterThan(2);
      if (q.kind === 'single' || q.kind === 'multi') {
        expect(q.options?.length ?? 0).toBeGreaterThanOrEqual(2);
        const oids = (q.options ?? []).map((o) => o.id);
        expect(new Set(oids).size).toBe(oids.length);
      }
      if (q.kind === 'scale') {
        expect(q.scale?.left).toBeTruthy();
        expect(q.scale?.right).toBeTruthy();
      }
    }
  });

  it('routes every sectionId to a real template', () => {
    for (const q of INTERVIEW_QUESTIONS) {
      for (const sid of q.sectionIds) {
        expect(TEMPLATE_BY_ID[sid], `${q.id} → ${sid}`).toBeTruthy();
      }
    }
  });

  it('tiers are cumulative and sized like the promise (quick < standard < in-depth)', () => {
    const quick = questionsForDepth('quick');
    const standard = questionsForDepth('standard');
    const indepth = questionsForDepth('indepth');
    expect(quick.length).toBeGreaterThanOrEqual(8);
    expect(quick.length).toBeLessThanOrEqual(10);
    expect(standard.length).toBeGreaterThan(quick.length);
    expect(indepth.length).toBeGreaterThan(standard.length);
    expect(indepth.length).toBe(INTERVIEW_QUESTIONS.length);
    // cumulative: every quick question is in standard, every standard in in-depth
    const sIds = new Set(standard.map((q) => q.id));
    for (const q of quick) expect(sIds.has(q.id)).toBe(true);
    // the free-text catch-all is in every set
    expect(quick.some((q) => q.kind === 'text')).toBe(true);
  });

  it('exposes 3 depths and 3 lengths (the nine outputs)', () => {
    expect(DEPTHS.length).toBe(3);
    expect(LENGTHS.length).toBe(3);
  });
});

describe('skeletons', () => {
  it('word budgets land inside the promised page bands', () => {
    // concise < 6 pages; working 6–15; full 15+
    expect(wordBudget('concise') / PAGE_WORDS).toBeLessThan(6);
    expect(wordBudget('working') / PAGE_WORDS).toBeGreaterThanOrEqual(6);
    expect(wordBudget('working') / PAGE_WORDS).toBeLessThanOrEqual(15);
    expect(wordBudget('full') / PAGE_WORDS).toBeGreaterThanOrEqual(15);
  });

  it('sections are unique, titled, and mapped to real templates (or explicitly custom)', () => {
    for (const [len, skel] of Object.entries(SKELETONS)) {
      const ids = skel.map((s) => s.id);
      expect(new Set(ids).size, len).toBe(ids.length);
      for (const s of skel) {
        expect(s.title.length).toBeGreaterThan(5);
        expect(s.words).toBeGreaterThanOrEqual(200);
        if (s.templateId !== null) expect(TEMPLATE_BY_ID[s.templateId], `${len}/${s.id}`).toBeTruthy();
      }
    }
  });

  it('every core section template can receive at least one routed question', () => {
    // each templateId used in any skeleton should have ≥1 question informing it,
    // except the custom executive summary (null) which takes the full digest
    const routed = new Set(INTERVIEW_QUESTIONS.flatMap((q) => q.sectionIds));
    for (const skel of Object.values(SKELETONS)) {
      for (const s of skel) {
        if (s.templateId === null) continue;
        expect(routed.has(s.templateId), s.templateId).toBe(true);
      }
    }
  });
});

describe('digest', () => {
  const answers: InterviewAnswer[] = [
    { id: 'ambition', optionIds: ['transform'], text: 'but do not overpromise' },
    { id: 'centralise', value: 80 },
    { id: 'sharing-posture', value: 20 },
    { id: 'big-bets', optionIds: ['identifier', 'quality'] },
    { id: 'anything-else', text: 'Keep the phrase "children first, data second".' },
  ];

  it('renders answered questions and skips unanswered ones', () => {
    const d = digestAnswers(INTERVIEW_QUESTIONS, answers);
    expect(d).toContain('Transform');
    expect(d).toContain('children first, data second');
    expect(d).toContain('80%'); // scale lean toward the right pole
    expect(d).not.toMatch(/undefined|NaN|\[object/);
    // unanswered questions leave no line
    expect(d).not.toContain('AI posture');
  });

  it('reads scale leans in plain language', () => {
    const q = QUESTION_BY_ID['centralise'];
    expect(digestAnswer(q, { id: 'centralise', value: 80 })).toContain('Federated');
    expect(digestAnswer(q, { id: 'centralise', value: 10 })).toContain('Centralised');
    expect(digestAnswer(q, { id: 'centralise', value: 50 })).toContain('balanced');
  });

  it('routes section digests: own questions first, framing always included', () => {
    const d = digestForSection('identifiers', INTERVIEW_QUESTIONS, answers);
    expect(d).toContain('Sharing posture'); // routed to identifiers
    expect(d).toContain('children first'); // the catch-all rides along
    const empty = digestForSection('security', INTERVIEW_QUESTIONS, answers);
    // no security answer given — falls back to framing only, never undefined
    expect(empty).not.toMatch(/undefined/);
  });

  it('returns empty for no answers', () => {
    expect(digestAnswers(INTERVIEW_QUESTIONS, [])).toBe('');
  });
});
