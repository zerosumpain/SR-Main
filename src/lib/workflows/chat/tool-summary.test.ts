import { describe, it, expect } from 'vitest';
import { summarizeToolResult, summarizeRunningTool } from './tool-summary';

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

/**
 * Regression cover for `web_extract` reading "Done — web extract".
 *
 * Same root cause as the web_search bug above, arriving from the other side:
 * Hermes previews native tool results at 600 chars, so a `web_extract` result is
 * a JSON string cut mid-object that `unwrap()` flattens to `{}`. With no count
 * and no title, the summariser fell through to the generic default — even though
 * the ARGUMENTS name the page exactly.
 *
 * The second trap is the argument shape: `urls` arrives as a JSON *string*
 * containing an array once it has been through Hermes' arg preview, not as an
 * array. Reading only the array form leaves nothing to say.
 */
const extract = (args: Record<string, unknown>, result: unknown, status: 'done' | 'error' = 'done') =>
  summarizeToolResult({ tool: 'web_extract', toolCallId: 'tc-x', args, result, status });

/** Verbatim from a recorded production trace. */
const CLIPPED = '{\n  "results": [\n    {\n      "url": "https://en.wikipedia.org/wiki/Ben_Nevis",\n      "title": "Ben Nevis",\n      "content": "# Ben Nevis: Summary\\n\\nBen Nevis is the highest mountain';

describe('summarizeToolResult — web_extract', () => {
  it('names the host when the result was clipped beyond parsing', () => {
    expect(extract({ urls: '["https://en.wikipedia.org/wiki/Ben_Nevis"]' }, CLIPPED)).toBe(
      'Read en.wikipedia.org',
    );
  });

  it('handles urls given as a real array', () => {
    expect(extract({ urls: ['https://www.parliament.uk/lords'] }, CLIPPED)).toBe('Read parliament.uk');
  });

  it('handles a single bare url string', () => {
    expect(extract({ url: 'https://gov.uk/rates' }, CLIPPED)).toBe('Read gov.uk');
  });

  it('counts distinct hosts when several pages were read', () => {
    const s = extract({ urls: ['https://a.com/1', 'https://b.com/2', 'https://a.com/3'] }, CLIPPED);
    expect(s).toBe('Read 2 pages — a.com, b.com');
  });

  it('prefers the page title when the result actually parsed', () => {
    const parsed = { results: [{ url: 'https://en.wikipedia.org/wiki/Ben_Nevis', title: 'Ben Nevis' }] };
    expect(extract({ urls: '["https://en.wikipedia.org/wiki/Ben_Nevis"]' }, parsed)).toBe(
      'Read “Ben Nevis” (en.wikipedia.org)',
    );
  });

  it('leads with the first title and a count for a multi-page parsed result', () => {
    const parsed = { results: [{ title: 'Rates 2026' }, { title: 'Allowances' }] };
    expect(extract({ urls: ['https://a.com/1', 'https://b.com/2'] }, parsed)).toBe(
      'Read 2 pages — “Rates 2026” and 1 more',
    );
  });

  it('never falls through to the generic "Done — web extract"', () => {
    for (const args of [{}, { urls: '' }, { urls: '[]' }, { urls: 'not json [' }]) {
      expect(extract(args, CLIPPED)).not.toContain('Done —');
    }
  });

  it('still reports failures through the error path', () => {
    expect(extract({ urls: '["https://a.com"]' }, { error: 'timeout after 30s' }, 'error')).toBe(
      'web_extract failed: timeout after 30s',
    );
  });
});

/**
 * The adapter-side fix: `_compact_web_extract` reduces the result to
 * `{count, results:[{title,url}]}` BEFORE the 600-char preview, mirroring what
 * `_compact_web_search` already did. Hermes sends args on `started` but not on
 * `completed`, so on the finished card the URL has to come from the result.
 */
describe('summarizeToolResult — web_extract, compacted by the adapter', () => {
  it('names the page from the result when the completed frame carries no args', () => {
    const compact = { count: 1, results: [{ title: 'Scafell Pike', url: 'https://en.wikipedia.org/wiki/Scafell_Pike' }] };
    expect(extract({}, compact)).toBe('Read “Scafell Pike” (en.wikipedia.org)');
  });

  it('counts multiple pages from the compacted result', () => {
    const compact = {
      count: 3,
      results: [
        { title: 'Rates', url: 'https://gov.uk/a' },
        { title: 'Allowances', url: 'https://parliament.uk/b' },
        { title: 'Notes', url: 'https://gov.uk/c' },
      ],
    };
    expect(extract({}, compact)).toBe('Read 3 pages — “Rates” and 2 more');
  });

  it('falls back to the host when the compacted rows have no titles', () => {
    expect(extract({}, { count: 1, results: [{ title: '', url: 'https://bbc.co.uk/news' }] })).toBe('Read bbc.co.uk');
  });
});

describe('summarizeRunningTool — web_extract', () => {
  it('names the host instead of echoing the JSON-encoded urls argument', () => {
    expect(summarizeRunningTool('web_extract', { urls: '["https://en.wikipedia.org/wiki/Ben_Nevis"]' })).toBe(
      'reading en.wikipedia.org',
    );
  });

  it('counts pages when several were requested', () => {
    expect(summarizeRunningTool('web_extract', { urls: ['https://a.com', 'https://b.com'] })).toBe('reading 2 pages');
  });

  it('degrades to a plain phrase with no usable url', () => {
    expect(summarizeRunningTool('web_extract', {})).toBe('reading a page');
  });
});
