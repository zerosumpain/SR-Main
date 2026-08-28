import { describe, expect, it, vi } from 'vitest';
import {
  buildResolution,
  parseResolution,
  preferencePairs,
  MAX_EXCERPT_CHARS,
  type ProposalResolution,
} from './resolution';

describe('buildResolution', () => {
  it('records a rejection without a final — nothing landed', () => {
    const r = buildResolution({
      id: 'p1',
      status: 'rejected',
      kind: 'prose',
      original: 'The site is a rounding error.',
      suggested: 'The website represents a negligible fraction of total traffic.',
      final: 'should be ignored on a rejection',
    });
    expect(r.status).toBe('rejected');
    expect(r.final).toBeUndefined();
    expect(r.suggested).toContain('negligible');
    expect(r.edited).toBeUndefined();
  });

  it('flags an edited acceptance — the model said X, the author shipped Y', () => {
    const r = buildResolution({
      id: 'p2',
      status: 'accepted',
      kind: 'prose',
      original: 'It is a small site.',
      suggested: 'It is, in many respects, a rather modest website.',
      final: 'The site is a rounding error.',
    });
    expect(r.edited).toBe(true);
    expect(r.final).toBe('The site is a rounding error.');
  });

  it('does not flag a plain acceptance', () => {
    const r = buildResolution({
      id: 'p3',
      status: 'accepted',
      kind: 'prose',
      suggested: 'Same text.',
      final: 'Same text.',
    });
    expect(r.edited).toBeUndefined();
  });

  it('clamps runaway excerpts', () => {
    const r = buildResolution({
      id: 'p4',
      status: 'accepted',
      kind: 'prose',
      suggested: 'x'.repeat(MAX_EXCERPT_CHARS + 500),
      final: 'y'.repeat(MAX_EXCERPT_CHARS + 500),
    });
    expect(r.suggested?.length).toBe(MAX_EXCERPT_CHARS);
    expect(r.final?.length).toBe(MAX_EXCERPT_CHARS);
    // Both were truncated from different sources, so it still reads as edited.
    expect(r.edited).toBe(true);
  });

  it('drops empty strings rather than storing blanks', () => {
    const r = buildResolution({
      id: 'p5',
      status: 'rejected',
      kind: 'meta',
      field: 'title',
      original: '   ',
      reason: '',
    });
    expect(r.original).toBeUndefined();
    expect(r.reason).toBeUndefined();
    expect(r.field).toBe('title');
  });

  it('stamps a timestamp when none is supplied', () => {
    const r = buildResolution({ id: 'p6', status: 'rejected', kind: 'prose' });
    expect(Number.isNaN(Date.parse(r.at))).toBe(false);
  });
});

describe('parseResolution', () => {
  it('round-trips what buildResolution writes', () => {
    const original = buildResolution({
      id: 'p7',
      status: 'accepted',
      kind: 'prose',
      original: 'before',
      suggested: 'model version',
      final: 'john version',
      reason: 'tightens it',
    });
    const parsed = parseResolution(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });

  it('still reads the legacy {id, status} rows written before this module', () => {
    const parsed = parseResolution(JSON.stringify({ id: 'old', status: 'accepted' }));
    expect(parsed?.id).toBe('old');
    expect(parsed?.status).toBe('accepted');
    expect(parsed?.suggested).toBeUndefined();
  });

  it('rejects malformed or non-resolution content', () => {
    expect(parseResolution('not json')).toBeNull();
    expect(parseResolution('null')).toBeNull();
    expect(parseResolution(JSON.stringify({ id: 'x' }))).toBeNull();
    expect(parseResolution(JSON.stringify({ id: 'x', status: 'pending' }))).toBeNull();
    expect(parseResolution(JSON.stringify({ status: 'accepted' }))).toBeNull();
  });
});

describe('recording failures', () => {
  it('recordResolutionBestEffort swallows and reports false', async () => {
    vi.resetModules();
    vi.doMock('./messages', () => ({
      appendMessage: () => Promise.reject(new Error('db down')),
    }));
    const mod = await import('./resolution');
    await expect(mod.recordResolution(1, { id: 'x', status: 'rejected', kind: 'prose' }))
      .rejects.toThrow('db down');
    expect(await mod.recordResolutionBestEffort(1, { id: 'x', status: 'rejected', kind: 'prose' }))
      .toBe(false);
    vi.doUnmock('./messages');
    vi.resetModules();
  });
});

describe('preferencePairs', () => {
  const rows: ProposalResolution[] = [
    { id: 'a', status: 'rejected', kind: 'prose', at: '' },
    { id: 'b', status: 'accepted', kind: 'prose', at: '' },
    { id: 'c', status: 'accepted', edited: true, kind: 'prose', at: '' },
  ];

  it('keeps rejections and edited acceptances, drops plain acceptances', () => {
    expect(preferencePairs(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });
});
