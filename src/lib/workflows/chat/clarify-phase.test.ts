import { describe, it, expect, afterEach } from 'vitest';
import { extractClarify, awaitClarifyAnswers } from './clarify-phase';
import { createJob, subscribeJob, respondToWaiter, cleanOldJobs } from './job-store';
import type { JobEvent } from './job-store';

afterEach(() => cleanOldJobs(0));

describe('extractClarify', () => {
  it('returns null when no block is present', () => {
    expect(extractClarify('no clarify here')).toBeNull();
  });

  it('parses a minimal block', () => {
    const raw = 'Hmm. <clarify>{"questions":[{"id":"q1","text":"Which one?","kind":"freeform"}]}</clarify>';
    const out = extractClarify(raw);
    expect(out).not.toBeNull();
    expect(out!.questions.length).toBe(1);
    expect(out!.questions[0].text).toBe('Which one?');
    expect(out!.cleaned).toBe('Hmm.');
  });

  it('caps at 3 questions', () => {
    const qs = [1, 2, 3, 4, 5].map((i) => ({ id: `q${i}`, text: `Q${i}` }));
    const raw = `<clarify>${JSON.stringify({ questions: qs })}</clarify>`;
    expect(extractClarify(raw)!.questions.length).toBe(3);
  });

  it('assigns fallback ids to unnamed questions', () => {
    const raw = '<clarify>{"questions":[{"text":"x"},{"text":"y"}]}</clarify>';
    const out = extractClarify(raw);
    expect(out!.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('returns null on malformed JSON', () => {
    expect(extractClarify('<clarify>{ not json }</clarify>')).toBeNull();
  });

  it('returns null on empty questions', () => {
    expect(extractClarify('<clarify>{"questions":[]}</clarify>')).toBeNull();
  });

  it('filters out questions with empty text', () => {
    const raw = '<clarify>{"questions":[{"id":"q1","text":""},{"id":"q2","text":"keep"}]}</clarify>';
    const out = extractClarify(raw);
    expect(out!.questions.map((q) => q.id)).toEqual(['q2']);
  });
});

describe('awaitClarifyAnswers', () => {
  it('emits a clarify event and resolves on respondToWaiter', async () => {
    const { jobId } = createJob('test');
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));

    const pending = awaitClarifyAnswers(jobId, [{ id: 'q1', text: 'Which?' }]);
    await new Promise((r) => setTimeout(r, 5));
    const ev = received.find((e) => e.type === 'clarify') as Extract<JobEvent, { type: 'clarify' }> | undefined;
    expect(ev).toBeDefined();
    respondToWaiter(jobId, `clarify:${ev!.clarifyId}`, { answers: { q1: 'option-a' } });
    await expect(pending).resolves.toEqual({ answers: { q1: 'option-a' } });
  });
});
