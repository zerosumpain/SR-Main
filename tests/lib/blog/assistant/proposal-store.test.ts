import { describe, it, expect } from 'vitest';
import { createProposalStore } from '$lib/blog/assistant/proposal-store';
import type { Proposal } from '$lib/blog/assistant/proposal';

const proseP: Proposal = {
  id: 'p1', kind: 'prose', original: 'old', suggested: 'new',
  anchor: { from: 0, to: 3 }, status: 'pending',
};
const metaP: Proposal = {
  id: 'm1', kind: 'meta', field: 'title',
  currentValue: 'A', suggestedValue: 'B', status: 'pending',
};

describe('proposal-store', () => {
  it('add() appends a proposal', () => {
    const s = createProposalStore();
    s.add(proseP);
    expect(s.list()).toHaveLength(1);
    expect(s.get('p1')).toEqual(proseP);
  });

  it('replace() swaps a proposal in place', () => {
    const s = createProposalStore();
    s.add(proseP);
    s.replace('p1', { ...proseP, id: 'p2', suggested: 'newer' });
    expect(s.get('p1')).toBeUndefined();
    expect(s.get('p2')?.suggested).toBe('newer');
  });

  it('resolve() updates status and keeps the row', () => {
    const s = createProposalStore();
    s.add(metaP);
    s.resolve('m1', 'accepted');
    expect(s.get('m1')?.status).toBe('accepted');
  });

  it('pending() returns only pending entries', () => {
    const s = createProposalStore();
    s.add(proseP);
    s.add(metaP);
    s.resolve('m1', 'rejected');
    expect(s.pending().map((p) => p.id)).toEqual(['p1']);
  });
});
