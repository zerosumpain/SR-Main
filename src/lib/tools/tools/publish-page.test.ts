import { describe, expect, it, vi } from 'vitest';

const writes: string[] = [];
vi.mock('$lib/jkai/sandbox', () => ({ getPublishedDir: () => '/nonexistent-published-dir' }));
vi.mock('fs/promises', () => ({
  mkdir: async (p: string) => void writes.push(`mkdir ${p}`),
  writeFile: async (p: string) => void writes.push(`write ${p}`),
}));

const { handlePublishPage } = await import('./publish-page');

describe('publish_page', () => {
  it('refuses a static key: a chat page must not land inside a hand-deployed bundle', async () => {
    const r = await handlePublishPage({ slug: 'Hometowns', content: '<!doctype html><p>hi</p>' });
    expect(r.success).toBe(false);
    expect(writes).toEqual([]);
  });

  it('still publishes an ordinary slug', async () => {
    const r = await handlePublishPage({ slug: 'weekly-report', content: '# Hi' });
    expect(r.success).toBe(true);
    expect(writes).toEqual([
      'mkdir /nonexistent-published-dir/weekly-report',
      'write /nonexistent-published-dir/weekly-report/index.html',
    ]);
  });
});
