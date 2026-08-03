import { describe, it, expect } from 'vitest';
import { summarizeToolResult } from './tool-summary';

/**
 * Regression cover for the "web_search always says 0 results" bug.
 *
 * Two stacked defects, both real:
 *  1. Hermes' `web_search` puts its rows under `data.web` (see
 *     tools/web_tools.py::web_search_tool) — a key `countOf()` didn't know, so
 *     even a fully parsed result counted 0.
 *  2. The jkai adapter previews tool results to 600 chars, so the JSON *string*
 *     Hermes returns arrived cut mid-object and `unwrap()` flattened it to `{}`.
 *     The adapter now sends a compact `{count, web:[…]}` object instead.
 */
const row = (i: number) => ({
  title: `White Scar Cave Prices ${i}`,
  url: `https://whitescarcave.co.uk/page${i}`,
  description: 'Adult £13.95, child £8.95 — family ticket available.',
  position: i,
});

const summarize = (result: unknown) =>
  summarizeToolResult({
    tool: 'web_search',
    toolCallId: 'tc-1',
    args: { query: 'White Scar Cave prices' },
    result,
    status: 'done',
  });

describe('summarizeToolResult — web_search', () => {
  it('counts rows the adapter sends as a compact {count, web} object', () => {
    const out = summarize({ count: 5, web: [row(1), row(2)] });
    expect(out).toContain('5 results');
    expect(out).toContain('top: whitescarcave.co.uk');
  });

  it('counts rows under Hermes’ data.web key when the object arrives whole', () => {
    const out = summarize({ success: true, data: { web: [row(1), row(2), row(3)] } });
    expect(out).toContain('3 results');
  });

  it('parses an untruncated JSON string result rather than reading it as empty', () => {
    const out = summarize(JSON.stringify({ success: true, data: { web: [row(1)] } }));
    expect(out).toContain('1 result');
    expect(out).not.toContain('0 results');
  });

  it('still degrades to 0 on a genuinely empty result set', () => {
    expect(summarize({ success: true, data: { web: [] } })).toContain('0 results');
  });

  it('does not throw on a truncated / unparseable string', () => {
    const cut = JSON.stringify({ success: true, data: { web: [row(1), row(2)] } }).slice(0, 60);
    expect(() => summarize(cut)).not.toThrow();
  });

  it('keeps the query in the summary', () => {
    expect(summarize({ count: 2, web: [row(1)] })).toContain('White Scar Cave prices');
  });
});
