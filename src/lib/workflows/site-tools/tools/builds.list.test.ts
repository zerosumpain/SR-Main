import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../registry';
import '../registry';

/**
 * Fake db rows used by build_list tests. select() is projection-aware: when the
 * handler passes a column projection (compact mode) it returns only the compact
 * fields; when it passes none (verbose mode) it returns the full rows.
 */
vi.mock('$lib/db', () => {
  const fullRows = [
    {
      id: 'b-1',
      title: 'Countdown timer',
      prompt: 'Build a countdown timer app with a big display and presets.',
      status: 'completed',
      publishedSlug: 'countdown-timer',
      createdAt: '2026-08-01T09:00:00.000Z',
      modelProvider: 'zai',
      modelId: 'glm-5.1',
      budgetConfig: { maxRounds: 5 },
      serveConfig: { port: 8080 },
      tokensUsed: 12345,
    },
    {
      id: 'b-2',
      title: null,
      prompt: 'A weather widget.',
      status: 'running',
      publishedSlug: null,
      createdAt: '2026-08-05T09:00:00.000Z',
      modelProvider: 'zai',
      modelId: 'glm-5.1',
      budgetConfig: {},
      serveConfig: null,
      tokensUsed: 100,
    },
  ];
  const COMPACT = ['id', 'title', 'status', 'publishedSlug', 'createdAt'];
  const compactRows = fullRows.map((r) => Object.fromEntries(COMPACT.map((k) => [k, (r as any)[k]])));
  const makeQueryBuilder = (projected: unknown) => {
    const q: any = {
      from: () => q,
      orderBy: () => q,
      where: () => q,
      limit: () => (projected ? compactRows : fullRows),
    };
    return q;
  };
  return { db: { select: vi.fn((proj: unknown) => makeQueryBuilder(proj)) } };
});

/**
 * build_list token bloat — issue #126.
 *
 * The bare `db.select().from(jkaiBuilds)` returned every column (prompt, config,
 * serve_config, model fields, price snapshot…) of up to 50 builds. Default is
 * now the compact projection; verbose:true opts back into the full rows.
 */
describe('build_list compact vs verbose', () => {
  it('returns compact rows by default (no heavy columns)', async () => {
    const r = (await executeTool('build_list', {})) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0];
    // Identifying fields present.
    expect(first.id).toBe('b-1');
    expect(first.title).toBe('Countdown timer');
    expect(first.status).toBe('completed');
    expect(first.publishedSlug).toBe('countdown-timer');
    expect(first.createdAt).toBeDefined();
    // Heavy columns dropped from the compact projection.
    expect('prompt' in first).toBe(false);
    expect('budgetConfig' in first).toBe(false);
    expect('serveConfig' in first).toBe(false);
    expect('modelProvider' in first).toBe(false);
    expect('tokensUsed' in first).toBe(false);
  });

  it('returns full rows when verbose:true', async () => {
    const r = (await executeTool('build_list', { verbose: true })) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0];
    expect(first.id).toBe('b-1');
    expect(first.prompt).toMatch(/countdown timer/i);
    expect(first.budgetConfig).toEqual({ maxRounds: 5 });
    expect(first.serveConfig).toEqual({ port: 8080 });
    expect(first.modelProvider).toBe('zai');
    expect(first.tokensUsed).toBe(12345);
  });
});
