// `browser` toolset — a real headless browser, running where the residential IP
// is (homeserv), driven from wherever chat happens.
//
// Verb set chosen from measured use on the chat surface over 30 days:
// console 74, navigate 52, click 21, snapshot 20, scroll 1, get_images 1. `type`
// is included because click-driven flows need it even though it did not appear;
// `vision` (6 calls) is deliberately left out — the vision path already exists in
// $lib/file-index/describe and belongs there, not behind a second front door.
import { register } from '../registry-internal';
import { runBrowserVerb } from '$lib/workflows/browser';

const SESSION_NOTE =
  'The browser keeps one page between calls, so navigate first, then act on it.';

register({
  name: 'browser_navigate',
  description: `Open a URL in the real browser and return its title, final URL and HTTP status. ${SESSION_NOTE} Use this when a page needs JavaScript, a login, or anything a plain fetch cannot see.`,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute URL, including scheme.' },
      waitUntil: {
        type: 'string',
        description: "'domcontentloaded' (default), 'load', or 'networkidle' for JS-heavy pages.",
      },
    },
    required: ['url'],
  },
  category: 'Browser',
  toolset: 'browser',
  handler: async (raw: Record<string, unknown>) =>
    toResult(await runBrowserVerb('navigate', (raw ?? {}) as Record<string, unknown>)),
});

register({
  name: 'browser_snapshot',
  description: `Read the current page: its visible text and up to 100 links. ${SESSION_NOTE} Call this after navigate or click to see what is actually there before deciding what to do next.`,
  parameters: { type: 'object', properties: {} },
  category: 'Browser',
  toolset: 'browser',
  handler: async () => toResult(await runBrowserVerb('snapshot', {})),
});

register({
  name: 'browser_console',
  description:
    'Return the browser console output for the current page — logs, warnings and uncaught page errors. The single most useful tool for working out why a page is misbehaving. Filter with `level` (e.g. "error").',
  parameters: {
    type: 'object',
    properties: {
      level: { type: 'string', description: "Optional filter: 'error', 'warning', 'log', 'pageerror'." },
      limit: { type: 'number', description: 'Max entries to return (default 100).' },
    },
  },
  category: 'Browser',
  toolset: 'browser',
  handler: async (raw: Record<string, unknown>) =>
    toResult(await runBrowserVerb('console', (raw ?? {}) as Record<string, unknown>)),
});

register({
  name: 'browser_click',
  description: `Click an element by CSS selector on the current page, then wait for it to settle. ${SESSION_NOTE}`,
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector, e.g. "button.submit" or "a[href*=next]".' },
      timeoutMs: { type: 'number', description: 'How long to wait for the element (default 10000).' },
    },
    required: ['selector'],
  },
  category: 'Browser',
  toolset: 'browser',
  handler: async (raw: Record<string, unknown>) =>
    toResult(await runBrowserVerb('click', (raw ?? {}) as Record<string, unknown>)),
});

register({
  name: 'browser_type',
  description: `Fill a field by CSS selector, optionally pressing Enter afterwards. ${SESSION_NOTE}`,
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the input.' },
      text: { type: 'string', description: 'Text to enter.' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false).' },
    },
    required: ['selector', 'text'],
  },
  category: 'Browser',
  toolset: 'browser',
  handler: async (raw: Record<string, unknown>) =>
    toResult(await runBrowserVerb('type', (raw ?? {}) as Record<string, unknown>)),
});

register({
  name: 'browser_scroll',
  description: 'Scroll the current page vertically, for content that loads as you go.',
  parameters: {
    type: 'object',
    properties: { dy: { type: 'number', description: 'Pixels to scroll; negative scrolls up. Default 800.' } },
  },
  category: 'Browser',
  toolset: 'browser',
  handler: async (raw: Record<string, unknown>) =>
    toResult(await runBrowserVerb('scroll', (raw ?? {}) as Record<string, unknown>)),
});

register({
  name: 'browser_get_images',
  description: 'List the images on the current page with their source URLs, alt text and natural dimensions.',
  parameters: { type: 'object', properties: {} },
  category: 'Browser',
  toolset: 'browser',
  handler: async () => toResult(await runBrowserVerb('get_images', {})),
});

register({
  name: 'browser_close',
  description:
    'Close the browser session and free its memory. Call this when finished with a browsing task. Harmless if no session is open; one is reaped automatically after 15 minutes idle.',
  parameters: { type: 'object', properties: {} },
  category: 'Browser',
  toolset: 'browser',
  handler: async () => toResult(await runBrowserVerb('close', {})),
});

/**
 * The daemon speaks `{ ok, ... }`; the site-tool contract is
 * `{ success, data | error }`. Map rather than leak, and keep the error text —
 * it is written to tell the model what it can do instead.
 */
function toResult(r: { ok: boolean; error?: string; [k: string]: unknown }) {
  if (!r || r.ok !== true) {
    return { success: false, error: r?.error ?? 'browser call failed' };
  }
  const { ok: _ok, ...data } = r;
  return { success: true, data };
}
