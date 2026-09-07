import { describe, expect, it } from 'vitest';
import { acceptanceBlocker, candidateChanged, newDelivery } from '$lib/jkai/development';

describe('development acceptance contract', () => {
  it('cannot equate a dispatched or green build with accepted functionality', () => {
    const state = newDelivery('Save a comparison', 'Health', ['Comparison survives reload']);
    expect(acceptanceBlocker(state)).toMatch(/brief/);
    state.brief.acceptedAt = new Date().toISOString();
    state.candidate = 'abc';
    state.gate = { passed: true, evidence: 'Tests passed', revision: 'abc' };
    expect(acceptanceBlocker(state)).toMatch(/preview/);
    state.preview = { url: 'http://127.0.0.1:5281', status: 'ready', detail: 'Synthetic database' };
    expect(acceptanceBlocker(state)).toMatch(/criterion/);
    state.criteria[0] = { ...state.criteria[0], verdict: 'passed', evidence: 'Saved then reloaded using local database', revision: 'abc' };
    expect(acceptanceBlocker(state)).toBeNull();
    state.decisions.push({ id: 'q', question: 'Who can see it?', answer: null });
    expect(acceptanceBlocker(state)).toMatch(/decisions/);
  });
  it('invalidates evidence, preview and acceptance when the candidate changes', () => {
    const state = newDelivery('A feature', 'Platform', ['It works']);
    state.candidate = 'before'; state.acceptedAt = 'today'; state.batch = 'batch';
    state.criteria[0] = { ...state.criteria[0], verdict: 'passed', evidence: 'Owner observed', revision: 'before' };
    const next = candidateChanged(state, 'after');
    expect(next.acceptedAt).toBeNull(); expect(next.batch).toBeNull(); expect(next.gate).toBeNull();
    expect(next.criteria[0].verdict).toBe('unverified'); expect(next.preview.status).toBe('unavailable');
    expect(state.candidate).toBe('before');
  });
});
