import { describe, it, expect, vi } from 'vitest';

const { runScrape } = vi.hoisted(() => ({ runScrape: vi.fn() }));
vi.mock('$lib/workflows/scraper/runner', () => ({ runScrape: (...a: any[]) => runScrape(...a) }));

import { webScrapeExecutor } from '$lib/workflows/nodes/web-scrape';

const ctx: any = { runId: 'r', emit: vi.fn(), getNodeOutput: () => undefined };

describe('webScrapeExecutor', () => {
  it('forwards config to runScrape and returns pages', async () => {
    runScrape.mockResolvedValue({
      success: true,
      pages: [{ url: 'https://x', fields: { title: 'Hi' } }],
      runLogId: 7,
    });

    const result = await webScrapeExecutor.execute(
      {},
      {
        url: 'https://x',
        profile: 'test',
        waitFor: { type: 'networkidle' },
        extract: [{ field: 'title', selector: 'h1' }],
      },
      ctx,
    );
    expect(result.output.success).toBe(true);
    expect(result.output.pages).toHaveLength(1);
    expect(result.output.pages[0].fields.title).toBe('Hi');
    expect(result.output.runLogId).toBe(7);
  });

  it('emits scraper.progress events as runner progresses', async () => {
    runScrape.mockImplementation(async (opts: any) => {
      opts.onProgress?.({ t: 'nav', url: 'https://x' });
      opts.onProgress?.({ t: 'page.done', url: 'https://x', pageIndex: 0 });
      return { success: true, pages: [], runLogId: 1 };
    });
    const emit = vi.fn();
    const ctx2: any = { ...ctx, emit };
    await webScrapeExecutor.execute({},
      { url: 'https://x', profile: 'p', waitFor: { type: 'networkidle' }, extract: [] },
      ctx2);
    const types = emit.mock.calls.map((c) => c[0].type);
    expect(types).toContain('scraper.progress');
  });

  it('interpolates url from input templates', async () => {
    runScrape.mockReset();
    runScrape.mockResolvedValue({ success: true, pages: [], runLogId: 1 });
    await webScrapeExecutor.execute(
      { jobUrl: 'https://example.com/path' },
      {
        url: '{{input.jobUrl}}',
        profile: 'p',
        waitFor: { type: 'networkidle' },
        extract: [],
      },
      ctx,
    );
    expect(runScrape).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/path' }));
  });
});
