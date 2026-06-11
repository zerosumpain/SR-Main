// retrieval.test.ts — the BM25 retrieval should surface the RIGHT corpus chunks for domain
// questions (incl. via synonym expansion), rank by score, and stay project-scoped.

import { describe, it, expect } from 'vitest';
import { retrieve, INDEX_META } from './retrieval.server';

describe('corpus retrieval', () => {
  it('has a populated index', () => {
    expect(INDEX_META.chunkCount).toBeGreaterThan(200);
  });

  it('returns scored, descending results capped per source', () => {
    const r = retrieve('how is the SEND funding cliff and high-needs deficit modelled?', 10);
    expect(r.length).toBeGreaterThan(0);
    for (let i = 1; i < r.length; i++) expect(r[i].score).toBeLessThanOrEqual(r[i - 1].score);
    const counts = new Map<string, number>();
    for (const c of r) counts.set(c.sourceKey, (counts.get(c.sourceKey) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(3); // diversity cap
  });

  it('finds SEND content for a SEND question', () => {
    const r = retrieve('special educational needs EHCP tribunal', 8);
    const text = r.map((c) => (c.title + ' ' + c.text).toLowerCase()).join(' ');
    expect(/send|ehcp|special educational|tribunal/.test(text)).toBe(true);
  });

  it('synonym expansion bridges vocabulary (childcare → early years)', () => {
    const r = retrieve('does free childcare for toddlers close the gap?', 8);
    const text = r.map((c) => (c.title + ' ' + c.text).toLowerCase()).join(' ');
    expect(/early years|eyfs|gld|30 hour|two-year|disadvantage/.test(text)).toBe(true);
  });

  it('finds methodology content for a calculation question', () => {
    const r = retrieve('how is attainment 8 calculated, teacher capacity not funding', 8);
    const text = r.map((c) => (c.title + ' ' + c.text).toLowerCase()).join(' ');
    expect(/attainment|capacity|teacher|funding|engine|method/.test(text)).toBe(true);
  });

  it('returns nothing meaningful for an empty query', () => {
    expect(retrieve('   ', 5).length).toBe(0);
  });
});
