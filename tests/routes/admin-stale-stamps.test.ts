import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Three admin surfaces read Hermes' own SQLite store, which stopped receiving
 * anything at 06:34 on 2026-08-24 when the engine did — and every one of them
 * rendered it as current.
 *
 * The sessions list is the worst of them, because nothing about it looks wrong:
 * `listSessions` is `ORDER BY started_at DESC LIMIT n` with no date filter, so
 * a dead store still produces a perfectly normal newest-first page. It just
 * never moves again.
 *
 * A windowed query cannot detect this — inside a dead window it returns
 * nothing, and inside a live one it merely repeats the window. So freshness is
 * read unwindowed, once, and carried onto each surface.
 */

describe('the frozen store is dated wherever it is read', () => {
  it('has one unwindowed freshness reader', () => {
    const src = read('src/lib/server/hermes-sessions.ts');
    expect(src).toMatch(/export async function getStoreFreshness/);
    // Unwindowed on purpose: a MAX over the window answers the wrong question.
    expect(src).toMatch(/SELECT MAX\(timestamp\) AS newest FROM messages;/);
  });

  it('returns null rather than a guess when it cannot be established', () => {
    const src = read('src/lib/server/hermes-sessions.ts');
    // Null reads as stale at every call site. A fabricated timestamp would read
    // as fresh, which is the failure this exists to prevent.
    expect(src).toMatch(/return epoch > 0 \? new Date\(epoch \* 1000\)\.toISOString\(\) : null;/);
  });

  it.each([
    ['telemetry', 'src/lib/server/hermes-sessions.ts'],
    ['tool audit', 'src/lib/server/hermes-sessions.ts'],
  ])('stamps the %s payload', (_label, path) => {
    expect(read(path)).toMatch(/storeNewestAt: await getStoreFreshness\(\)/);
  });

  it('stamps the status payload too — version and curator come from that store', () => {
    const src = read('src/lib/server/hermes-control.ts');
    expect(src).toMatch(/storeNewestAt: string \| null;/);
    expect(src).toMatch(/getStoreFreshness\(\)/);
  });

  it('does NOT stamp services — systemctl is live and true', () => {
    // The one field on that object still answering a question about right now.
    const src = read('src/lib/server/hermes-control.ts');
    expect(src).toMatch(/serviceState\(GATEWAY_UNIT\)/);
    expect(src).toMatch(/LIVE and true/);
  });

  it.each([
    'src/routes/admin/ops/sessions/+page.svelte',
    'src/routes/admin/ops/engine/+page.svelte',
    'src/routes/admin/ops/tool-usage/+page.svelte',
  ])('%s renders the date', (path) => {
    expect(read(path)).toMatch(/storeNewestAt/);
  });

  it('says which half of tool-usage is live', () => {
    // getToolErrorRates already reads jkai_tool_traces. Calling the whole page
    // frozen would be as wrong as calling it current.
    expect(read('src/routes/admin/ops/tool-usage/+page.svelte')).toMatch(/jkai_tool_traces and are live/);
  });
});

describe('the engine panel describes the engine that is running', () => {
  const src = read('src/routes/admin/ops/engine/+page.svelte');

  it('no longer claims skills, delegation, web search and browser control are missing', () => {
    // All four shipped in #429/#430. The panel was talking the reader out of
    // the engine actually serving their chat.
    expect(src).not.toMatch(/skills, delegation, web search and browser control do not/);
  });

  it('names the two that genuinely are absent', () => {
    expect(src).toMatch(/Terminal and file editing are the two that genuinely are not here/);
  });

  it('warns that switching back will not start the stopped unit', () => {
    expect(src).toMatch(/does not start it/);
  });
});
