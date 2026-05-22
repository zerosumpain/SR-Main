import { describe, it, expect } from 'vitest';
import { runTool } from '$lib/blog/assistant/tools';
import type { Proposal } from '$lib/blog/assistant/proposal';

const snapshot = {
  id: 1, title: 'old title', excerpt: 'e', slug: 's',
  content: 'first sentence. second sentence. third sentence.',
  contentFormat: 'html' as const, status: 'draft' as const,
  coverImageUrl: null, coverImageAlt: null, publishedAt: null,
  previewToken: 't', tags: ['x'],
};

const ctx = () => ({ postId: 1, snapshot: { ...snapshot } });

describe('runTool — proposal mode', () => {
  it('update_title returns a meta proposal', async () => {
    const r = await runTool('update_title', { title: 'new' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('title');
    expect(p.suggestedValue).toBe('new');
    expect(p.currentValue).toBe('old title');
    expect(p.status).toBe('pending');
  });

  it('update_tags returns a meta proposal with array values', async () => {
    const r = await runTool('update_tags', { tags: ['a', 'b'] }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('tags');
    expect(p.suggestedValue).toEqual(['a', 'b']);
    expect(p.currentValue).toEqual(['x']);
  });

  it('set_status returns a meta proposal', async () => {
    const r = await runTool('set_status', { status: 'published' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('status');
    expect(p.suggestedValue).toBe('published');
  });

  it('read_post returns the snapshot directly', async () => {
    const r = await runTool('read_post', {}, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.snapshot as { title: string }).title).toBe('old title');
  });

  it('returns error for unknown tool', async () => {
    const r = await runTool('nope', {}, ctx());
    expect(r.ok).toBe(false);
  });
});
