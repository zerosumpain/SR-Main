import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { env } from '$env/dynamic/private';
import { executeSiteTool, isDestructiveTool, isRegisteredTool } from './executor';
import { resetRemoteCatalogue } from './remote';

/**
 * The seam with the catalogue on the other side of a wire.
 *
 * This is the deployment the whole contract exists for and the one nothing in
 * Main runs, so it is the one worth standing up: `JKAI_TOOL_INVOKE_URL` set, a
 * fake Main on a socket, and all three predicates asked their question.
 *
 * Converting only `executeSiteTool` would have passed every other test in this
 * repo and failed in production twice — every Main tool answering "Unknown
 * function" because `isRegisteredTool` still read the local catalogue, and then
 * the confirmation card silently disappearing because `isDestructiveTool` did
 * too. Both are asserted here.
 */

/**
 * The LOCAL catalogue is faked, and that is not laziness.
 *
 * `./registry` imports 75 tool modules for their `register()` side effects, and
 * importing it from a test boots the platform with them — this file logged
 * baileys connecting to WhatsApp before the mock went in, which is the hazard
 * `reference_test_imports_boot_platform_services` records. The in-process
 * branch is covered by the rest of the suite; what is being asserted here is
 * which side of the seam answers, and a two-entry fake says that precisely.
 */
vi.mock('./load-registry', () => ({
  loadToolRegistry: async () => ({
    isRegisteredTool: (name: string) => name === 'site_blog_list' || name === 'gmail_send',
    getTool: (name: string) =>
      name === 'gmail_send'
        ? { name, destructive: true }
        : name === 'site_blog_list'
          ? { name, destructive: false }
          : undefined,
    executeTool: async () => ({ success: true, data: 'in process' }),
  }),
}));

const TOKEN = 'w'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = {
  url: env.JKAI_TOOL_INVOKE_URL,
  token: env.JKAI_TOOL_INVOKE_TOKEN,
};

/** Set per test: how the fake Main behaves. */
let catalogueStatus = 200;
let catalogueBody: unknown = {
  tools: [
    { name: 'site_blog_list', destructive: false },
    { name: 'gmail_send', destructive: true },
  ],
};
let invokeHandler: (res: http.ServerResponse) => void = (res) => {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.end('{"result":{"success":true,"data":"from the wire"}}\n');
};

let server: http.Server;
let requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    req.resume();
    req.on('end', () => {
      if (req.url === '/api/platform/tools/catalogue') {
        res.writeHead(catalogueStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(catalogueBody));
        return;
      }
      invokeHandler(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  catalogueStatus = 200;
  catalogueBody = {
    tools: [
      { name: 'site_blog_list', destructive: false },
      { name: 'gmail_send', destructive: true },
    ],
  };
  resetRemoteCatalogue();
  const { port } = server.address() as AddressInfo;
  mutableEnv.JKAI_TOOL_INVOKE_URL = `http://127.0.0.1:${port}/api/platform/tools/invoke`;
  mutableEnv.JKAI_TOOL_INVOKE_TOKEN = TOKEN;
});

afterEach(() => {
  resetRemoteCatalogue();
  if (original.url === undefined) delete mutableEnv.JKAI_TOOL_INVOKE_URL;
  else mutableEnv.JKAI_TOOL_INVOKE_URL = original.url;
  if (original.token === undefined) delete mutableEnv.JKAI_TOOL_INVOKE_TOKEN;
  else mutableEnv.JKAI_TOOL_INVOKE_TOKEN = original.token;
});

describe('the seam, delegating', () => {
  it('runs a tool over the wire', async () => {
    await expect(executeSiteTool('site_blog_list', {})).resolves.toEqual({
      success: true,
      data: 'from the wire',
    });
    expect(requests).toContain('POST /api/platform/tools/invoke');
  });

  it('answers isRegisteredTool from the remote catalogue', async () => {
    await expect(isRegisteredTool('site_blog_list')).resolves.toBe(true);
    await expect(isRegisteredTool('not_a_tool')).resolves.toBe(false);
    expect(requests.filter((r) => r.includes('catalogue'))).toHaveLength(1);
  });

  it('answers isDestructiveTool from the remote catalogue', async () => {
    await expect(isDestructiveTool('gmail_send')).resolves.toBe(true);
    await expect(isDestructiveTool('site_blog_list')).resolves.toBe(false);
  });

  it('fetches the catalogue once for concurrent callers', async () => {
    await Promise.all([
      isRegisteredTool('site_blog_list'),
      isDestructiveTool('gmail_send'),
      isRegisteredTool('gmail_send'),
    ]);
    expect(requests.filter((r) => r.includes('catalogue'))).toHaveLength(1);
  });

  /**
   * The direction of a wrong answer is not symmetric. A needless confirmation
   * is an annoyance; a skipped one sends the email.
   */
  it('treats an unreadable catalogue as destructive', async () => {
    catalogueStatus = 500;
    await expect(isDestructiveTool('gmail_send')).resolves.toBe(true);
    await expect(isDestructiveTool('site_blog_list')).resolves.toBe(true);
  });

  it('treats a name the catalogue does not carry as destructive', async () => {
    await expect(isDestructiveTool('something_new')).resolves.toBe(true);
  });

  /**
   * In-process `executeSiteTool` cannot reject — `registry.executeTool` catches
   * a handler's throw and returns a failed result. `general-chat` calls this
   * bare inside a `Promise.all` over a turn's tool calls, so a rejection would
   * take the whole batch down instead of giving the model one failed result.
   */
  it('returns a failed result on a transport failure, rather than throwing', async () => {
    invokeHandler = (res) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('bad gateway');
    };
    const result = await executeSiteTool('site_blog_list', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/502/);
  });

  it('returns a failed result when the stream dies mid-answer', async () => {
    invokeHandler = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"status":"working"}\n');
      res.destroy();
    };
    const result = await executeSiteTool('site_blog_list', {});
    expect(result.success).toBe(false);
  });
});

describe('the seam, in-process', () => {
  // The path Main actually takes. Unset means the wire does not exist, and
  // nothing here should reach the socket.
  beforeEach(() => {
    delete mutableEnv.JKAI_TOOL_INVOKE_URL;
    delete mutableEnv.JKAI_TOOL_INVOKE_TOKEN;
    resetRemoteCatalogue();
  });

  /**
   * The assertion is that NOTHING reaches the socket — not what the local
   * registry answers. Loading the real catalogue here would pull 75 tool
   * modules and their database reach, which is what `load-registry.ts` exists
   * to keep off everyone's static graph; the rest of the suite covers what it
   * says. What matters here is that the wire is not consulted at all.
   */
  it('asks the local catalogue and never the wire', async () => {
    await expect(isRegisteredTool('site_blog_list')).resolves.toBe(true);
    await expect(isRegisteredTool('definitely_not_a_tool')).resolves.toBe(false);
    await expect(isDestructiveTool('gmail_send')).resolves.toBe(true);
    await expect(isDestructiveTool('site_blog_list')).resolves.toBe(false);
    await expect(executeSiteTool('site_blog_list', {})).resolves.toEqual({
      success: true,
      data: 'in process',
    });
    expect(requests).toEqual([]);
  });

  it('stays closed when only one half of the pair is set', async () => {
    mutableEnv.JKAI_TOOL_INVOKE_URL = 'http://127.0.0.1:1/api/platform/tools/invoke';
    await expect(isRegisteredTool('site_blog_list')).resolves.toBe(true);
    expect(requests).toEqual([]);
  });

  // In-process, a destructive flag the local registry does not carry is FALSE —
  // the opposite of the wire's fail-closed reading, and deliberately so. A
  // local catalogue that does not have the name means the tool does not exist,
  // and `general-chat` has already refused it at `isRegisteredTool`. Over the
  // wire the same silence can mean "could not ask", which is the case worth
  // failing closed on.
  it('does not fail closed in-process, where silence means absent', async () => {
    await expect(isDestructiveTool('definitely_not_a_tool')).resolves.toBe(false);
    expect(requests).toEqual([]);
  });
});
