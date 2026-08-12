import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

// The pi extension that bridges site tools into the autonomous builder. It is a
// plain CommonJS file in static/ (pi loads it by path from inside the sandbox),
// so it is required rather than imported.
//
// These tests exist because this file silently registered NOTHING for months.
// It ended with `return { tools: piTools }`, and pi's loader does
// `await factory(api)` and DISCARDS the return value — tools only reach pi via
// `api.registerTool(...)`. The agent ran on pi's seven built-ins while the
// extension logged "registered 174 JKAI tools", a line about its own array.
//
// So: assert on what is handed to `api.registerTool`, never on a log line, and
// assert the SHAPE pi actually requires. Every field checked below is one that
// pi needs and whose absence fails silently — the tool is simply not there.
const requireCjs = createRequire(import.meta.url);
const EXTENSION_PATH = join(process.cwd(), 'static/jkai-extensions/jkai-tools.js');

// The repo is `"type": "module"`, so node reads a bare .js as ESM and chokes on
// `module.exports`. pi does not care — it loads extensions through jiti, which
// handles CommonJS whatever the surrounding package says. Copying to a .cjs
// reproduces what pi effectively does, and keeps the test honest about the file
// as it actually ships.
let tmpCopy: string | null = null;

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
};

function loadExtension() {
  if (!tmpCopy) {
    tmpCopy = join(mkdtempSync(join(tmpdir(), 'jkai-ext-')), 'jkai-tools.cjs');
  }
  writeFileSync(tmpCopy, readFileSync(EXTENSION_PATH, 'utf8'));
  delete requireCjs.cache[requireCjs.resolve(tmpCopy)];
  return requireCjs(tmpCopy) as (api: unknown) => Promise<unknown>;
}

function fakeApi() {
  const registered: RegisteredTool[] = [];
  const logs: string[] = [];
  return {
    registered,
    logs,
    api: {
      registerTool: (t: RegisteredTool) => registered.push(t),
      log: (m: string) => logs.push(m),
    },
  };
}

const MANIFEST = {
  tools: [
    {
      name: 'workflow_list',
      description: 'List workflows',
      parameters: { type: 'object', properties: { verbose: { type: 'boolean' } } },
    },
    { name: 'datastore_query', description: 'Query the datastore', parameters: undefined },
  ],
};

describe('jkai-tools pi extension', () => {
  beforeEach(() => {
    process.env.JKAI_API_URL = 'http://jkai.test';
    process.env.JKAI_BRIDGE_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.JKAI_API_URL;
    delete process.env.JKAI_BRIDGE_TOKEN;
  });

  it('registers every manifest tool through api.registerTool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const { api, registered } = fakeApi();
    await loadExtension()(api);
    expect(registered.map((t) => t.name)).toEqual(['workflow_list', 'datastore_query']);
  });

  // Each of these is required by pi's ToolDefinition. Omitting any of them does
  // not throw — the tool just never reaches the model.
  it('hands pi the full tool shape it requires', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const { api, registered } = fakeApi();
    await loadExtension()(api);
    const tool = registered[0];
    expect(tool.name).toBe('workflow_list');
    expect(tool.label).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toEqual(MANIFEST.tools[0].parameters);
    expect(typeof tool.execute).toBe('function');
    // `handler` was the old, wrong name — pi never calls it.
    expect((tool as unknown as { handler?: unknown }).handler).toBeUndefined();
  });

  it('defaults parameters to an empty object schema when the manifest omits them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const { api, registered } = fakeApi();
    await loadExtension()(api);
    expect(registered[1].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('execute posts to /invoke and returns pi AgentToolResult content', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/manifest')) {
          return new Response(JSON.stringify(MANIFEST), { status: 200 });
        }
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true, result: { count: 3 } }), { status: 200 });
      }),
    );
    const { api, registered } = fakeApi();
    await loadExtension()(api);

    const out = await registered[0].execute('call-1', { verbose: true });
    expect(calls[0].url).toBe('http://jkai.test/api/jkai/tools/invoke');
    expect(calls[0].body).toEqual({ name: 'workflow_list', args: { verbose: true } });
    // A bare string here would be dropped: pi needs {content:[{type,text}]}.
    expect(out.content[0].type).toBe('text');
    expect(out.content[0].text).toContain('"count": 3');
  });

  it('throws on a tool error, which is how pi produces an isError result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/manifest')
          ? new Response(JSON.stringify(MANIFEST), { status: 200 })
          : new Response(JSON.stringify({ ok: false, error: 'nope' }), { status: 200 }),
      ),
    );
    const { api, registered } = fakeApi();
    await loadExtension()(api);
    await expect(registered[0].execute('call-1', {})).rejects.toThrow(/nope/);
  });

  // Failing closed must never look like success — that is the whole lesson.
  it('registers nothing and says so when the manifest fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { api, registered, logs } = fakeApi();
    await loadExtension()(api);
    expect(registered).toHaveLength(0);
    expect(logs.join(' ')).toMatch(/NO site tools/i);
  });

  it('registers nothing and says so without a bridge token', async () => {
    delete process.env.JKAI_BRIDGE_TOKEN;
    const { api, registered, logs } = fakeApi();
    await loadExtension()(api);
    expect(registered).toHaveLength(0);
    expect(logs.join(' ')).toMatch(/NO site tools/i);
  });

  it('fails loudly on a pi with no registerTool rather than reporting success', async () => {
    const logs: string[] = [];
    await loadExtension()({ log: (m: string) => logs.push(m) });
    expect(logs.join(' ')).toMatch(/FATAL|no api\.registerTool/i);
  });
});
