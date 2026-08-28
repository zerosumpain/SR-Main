import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * A store that has stopped receiving must not render as current.
 *
 * This was written for a store that did exactly that: the retired gateway's own
 * SQLite stopped at 06:34 on 2026-08-24 and three admin surfaces went on showing
 * it as live. The sessions list was the worst of them, because nothing about it
 * looked wrong — `ORDER BY started_at DESC LIMIT n` with no date filter produces
 * a perfectly normal newest-first page off a dead table. It just never moved
 * again.
 *
 * That store and those surfaces are gone. The property is not: tool usage and
 * call efficiency now read `jkai_tool_traces`, and the same mistake is available
 * to them the day recording stops. A WINDOWED query cannot detect it — inside a
 * dead window it returns nothing, and inside a live one it merely repeats the
 * window — so freshness must be read unwindowed and carried onto the surface.
 */

describe('trace-backed reads date their own store', () => {
  const audit = read('src/lib/server/tool-audit.ts');

  it('reads newest and oldest UNWINDOWED', () => {
    // Both sit in a sub-select with no `created_at >=` filter, unlike every
    // other query in the file. That difference is the whole point.
    expect(audit).toMatch(/\(SELECT max\(created_at\) FROM jkai_tool_traces\)\s+AS newest/);
    expect(audit).toMatch(/\(SELECT min\(created_at\) FROM jkai_tool_traces\)\s+AS oldest/);
  });

  it('returns null rather than a guess when the table is empty', () => {
    // Null reads as stale at the call site. A fabricated timestamp would read
    // as fresh, which is the failure this exists to prevent.
    expect(audit).toMatch(/storeNewestAt: m\.newest \? new Date\(m\.newest as string\)\.toISOString\(\) : null/);
    expect(audit).toMatch(/coverageFrom: m\.oldest \? new Date\(m\.oldest as string\)\.toISOString\(\) : null/);
  });

  it('carries the same unwindowed freshness onto call efficiency', () => {
    // `newestTurnAt` is what stops a policy trial being graded on evidence
    // older than the trial itself.
    const eff = read('src/lib/selfimprove/call-efficiency.ts');
    expect(eff).toMatch(/newestTurnAt/);
    // The freshness query is the one without a day window.
    const fresh = eff.slice(eff.indexOf('const fresh = await db.execute'));
    expect(fresh.slice(0, 400)).not.toContain('INTERVAL');
  });

  it('renders the date on the page that reads it', () => {
    const page = read('src/routes/admin/ops/tool-usage/+page.svelte');
    expect(page).toMatch(/storeNewestAt/);
    // And says when recording actually began, so an empty window is not read as
    // a clean bill of health.
    expect(page).toMatch(/coverageFrom/);
  });
});
