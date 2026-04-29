import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runTool } from '$lib/blog/assistant/tools';
import * as blog from '$lib/blog';
import { createUndoStore } from '$lib/blog/assistant/undo-store';

vi.mock('$lib/blog');

describe('runTool', () => {
  const undoStore = createUndoStore({ ttlMs: 60_000 });
  const ctx = () => ({
    postId: 1,
    snapshot: {
      id: 1, title: 'old', excerpt: 'e', slug: 's', tags: ['x'],
      content: '<p/>', contentFormat: 'html' as const,
      status: 'draft' as const, coverImageUrl: null, coverImageAlt: null,
      publishedAt: null, previewToken: 't',
    },
    undoStore,
  });

  beforeEach(() => vi.clearAllMocks());

  it('update_title applies and returns undo token', async () => {
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const r = await runTool('update_title', { title: 'new' }, ctx());
    expect(blog.updatePostFields).toHaveBeenCalledWith(1, { title: 'new' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.undoToken).toBe('string');
  });

  it('update_slug rejects if slug already taken', async () => {
    vi.mocked(blog.isSlugTaken).mockResolvedValue(true);
    const r = await runTool('update_slug', { slug: 'taken' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already in use/i);
  });

  it('patch_content errors when find string is missing', async () => {
    const r = await runTool('patch_content', { find: 'missing', replace: 'x' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found/i);
  });

  it('patch_content errors when find string is non-unique', async () => {
    const c = ctx();
    c.snapshot.content = 'aa aa';
    const r = await runTool('patch_content', { find: 'aa', replace: 'bb' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not unique/i);
  });

  it('set_status=published sets publishedAt when first publishing', async () => {
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const r = await runTool('set_status', { status: 'published' }, ctx());
    expect(r.ok).toBe(true);
    const args = vi.mocked(blog.updatePostFields).mock.calls[0][1];
    expect(args.status).toBe('published');
    expect(args.publishedAt).toBeInstanceOf(Date);
  });

  it('read_post returns the snapshot and writes nothing', async () => {
    const r = await runTool('read_post', {}, ctx());
    expect(r.ok).toBe(true);
    expect(blog.updatePostFields).not.toHaveBeenCalled();
    if (r.ok) expect(r.result).toMatchObject({ title: 'old' });
  });

  it('returns error for unknown tool', async () => {
    const r = await runTool('nope', {}, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown tool/i);
  });
});
