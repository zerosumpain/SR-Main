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

/**
 * Hermes' own tools were all rendering as "Done — <tool>".
 *
 * Two reasons, both structural rather than per-tool: the existing file cases are
 * named for the SITE tools (`file_read`/`file_list`/`file_search`) and never
 * matched Hermes' `read_file`/`write_file`/`search_files`; and every Hermes
 * result is preview-capped at 600 chars, so there is nothing parseable to
 * summarise from. These read the arguments instead — which reach a finished card
 * only because the frame adapter carries them over from the `started` frame.
 */
const native = (tool: string, args: Record<string, unknown>, result: unknown = 'clipped output…') =>
  summarizeToolResult({ tool, toolCallId: 'tc-n', args, result, status: 'done' });

describe('summarizeToolResult — Hermes native tools', () => {
  it('names the command a terminal call ran', () => {
    expect(native('terminal', { command: 'npm run gate' })).toBe('Ran `npm run gate`');
  });

  it('collapses a multi-line command to its first real line', () => {
    expect(native('terminal', { command: '# build it\ncd /srv && make all\nmake test' })).toBe('Ran `cd /srv && make all`');
  });

  it('names files by basename, not by absolute path', () => {
    expect(native('read_file', { path: '/home/john/strange_rambling_svelte/src/lib/x.ts' })).toBe('Read x.ts');
    expect(native('patch', { path: '/a/b/adapter.py', mode: 'replace' })).toBe('Patched adapter.py');
  });

  it('reports how much was written', () => {
    expect(native('write_file', { path: '/tmp/page.html', content: 'x'.repeat(1234) })).toBe(
      'Wrote page.html (1,234 chars)',
    );
  });

  it('names a non-default patch mode', () => {
    expect(native('patch', { path: '/a/b.ts', mode: 'append' })).toBe('Patched b.ts (append)');
  });

  it('quotes the pattern a file search looked for', () => {
    expect(native('search_files', { pattern: 'summarizeToolResult', path: '/src' })).toBe(
      'Searched for "summarizeToolResult" in src',
    );
  });

  it('prefers a real match count when the result parsed', () => {
    expect(native('search_files', { pattern: 'foo' }, { count: 3 })).toBe('3 matches for "foo"');
  });

  it('names the host a browser navigated to', () => {
    expect(native('browser_navigate', { url: 'https://www.parliament.uk/lords/x' })).toBe('Opened parliament.uk');
  });

  it('describes browser interactions concretely', () => {
    expect(native('browser_click', { ref: 'e81' })).toBe('Clicked e81');
    expect(native('browser_press', { key: 'Enter' })).toBe('Pressed Enter');
    expect(native('browser_scroll', { direction: 'down' })).toBe('Scrolled down');
    expect(native('browser_type', { ref: 'e5', text: 'amflow PR carbon' })).toBe('Typed “amflow PR carbon”');
    expect(native('browser_snapshot', { full: true })).toBe('Read the full page');
  });

  it('names the skill that was read or changed', () => {
    expect(native('skill_view', { name: 'jkai-canvas' })).toBe('Read the jkai-canvas skill');
    expect(native('skill_manage', { action: 'create', name: 'sr-design-system' })).toBe(
      'Created the sr-design-system skill',
    );
  });

  it('words memory and cron actions as outcomes', () => {
    expect(native('memory', { action: 'add', target: 'memory' })).toBe('Saved to memory');
    expect(native('cronjob', { action: 'create', name: 'PAC reminder' })).toBe('Scheduled “PAC reminder”');
    expect(native('cronjob', { action: 'list' })).toBe('Listed scheduled jobs');
    expect(native('process', { action: 'poll', session_id: 'proc_1' })).toBe('Checked a background process');
  });

  it('counts a todo list given as a real array', () => {
    expect(native('todo', { todos: [{ id: '1' }, { id: '2' }] })).toBe('Updated the plan (2 items)');
  });

  it('refuses to invent a count from a Python-repr todos argument', () => {
    // Single quotes — not JSON. A fabricated count would be worse than none.
    expect(native('todo', { todos: "[{'id': '1', 'content': 'x'}]" })).toBe('Updated the plan');
  });

  it('degrades to a plain phrase when the arguments are missing entirely', () => {
    for (const tool of ['terminal', 'read_file', 'write_file', 'patch', 'search_files', 'browser_navigate', 'skill_view']) {
      const s = native(tool, {});
      expect(s).not.toContain('Done —');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('never leaves a busy Hermes tool on the generic default', () => {
    const busiest = [
      'terminal', 'browser_navigate', 'browser_console', 'search_files', 'read_file',
      'execute_code', 'browser_snapshot', 'browser_click', 'skill_view', 'session_search',
      'patch', 'write_file', 'todo', 'browser_type', 'browser_press', 'memory',
      'browser_scroll', 'kanban_show', 'cronjob', 'process', 'browser_vision', 'skill_manage',
    ];
    for (const tool of busiest) {
      expect(native(tool, {}), tool).not.toContain('Done —');
    }
  });
});

describe('summarizeRunningTool — Hermes native tools', () => {
  it('does not echo raw arguments into the running line', () => {
    expect(summarizeRunningTool('terminal', { command: 'npm run gate', timeout: 60 })).toBe('running `npm run gate`');
    expect(summarizeRunningTool('browser_click', { ref: 'e81' })).toBe('clicking e81');
    expect(summarizeRunningTool('read_file', { path: '/a/b/c.ts' })).toBe('reading c.ts');
    expect(summarizeRunningTool('browser_navigate', { url: 'https://gov.uk/x' })).toBe('opening gov.uk');
  });
});
