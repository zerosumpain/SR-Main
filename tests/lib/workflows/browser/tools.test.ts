import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runVerb } = vi.hoisted(() => ({ runVerb: vi.fn() }));
vi.mock('$lib/workflows/browser', () => ({ runBrowserVerb: (...a: unknown[]) => runVerb(...a) }));

import '$lib/workflows/site-tools/registry';
import { tools } from '$lib/workflows/site-tools/registry-internal';

const byName = (n: string) => tools.find((t) => t.name === n);
const run = async (n: string, args: Record<string, unknown> = {}) =>
  (await byName(n)!.handler(args)) as { success: boolean; data?: Record<string, unknown>; error?: string };

beforeEach(() => vi.clearAllMocks());

const VERBS = [
  'browser_navigate', 'browser_snapshot', 'browser_console', 'browser_click',
  'browser_type', 'browser_scroll', 'browser_get_images', 'browser_close',
];

describe('browser toolset', () => {
  it('registers every verb the measured usage needs', () => {
    for (const n of VERBS) {
      expect(byName(n), `${n} missing`).toBeDefined();
      expect(byName(n)!.toolset).toBe('browser');
    }
  });

  it('maps the daemon envelope onto the site-tool contract', async () => {
    runVerb.mockResolvedValue({ ok: true, url: 'https://x', title: 'T' });
    const r = await run('browser_navigate', { url: 'https://x' });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ url: 'https://x', title: 'T' });
    expect(r.data).not.toHaveProperty('ok');
  });

  it('preserves the daemon error text — it is written for the model to act on', async () => {
    runVerb.mockResolvedValue({
      ok: false,
      error: 'the browser on homeserv is unreachable. Say so rather than guessing.',
    });
    const r = await run('browser_snapshot');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/rather than guessing/);
  });

  it('never throws out of a tool handler, whatever comes back', async () => {
    runVerb.mockResolvedValue(undefined as never);
    const r = await run('browser_console');
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('passes arguments through untouched', async () => {
    runVerb.mockResolvedValue({ ok: true });
    await run('browser_click', { selector: 'a.next', timeoutMs: 3000 });
    expect(runVerb).toHaveBeenCalledWith('click', { selector: 'a.next', timeoutMs: 3000 });
  });

  it('is NOT always-on — browsing is opt-in, unlike discovery', () => {
    // It costs a Chromium; the classifier or an explicit activate_toolset brings
    // it in. Discovery is always-on because it is free and self-referential.
    expect(byName('browser_navigate')!.toolset).toBe('browser');
  });
});
