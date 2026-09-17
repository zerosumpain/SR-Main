import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The catalogue endpoint — two fields per tool, and nothing the model reads.
 *
 * It exists because `executeSiteTool` is not the only question asked of the
 * catalogue: `isRegisteredTool` decides whether chat calls a tool at all, and
 * `isDestructive` decides whether it raises a confirmation card first. Leaving
 * those local would fail loudly for the first and SILENTLY for the second.
 */

vi.mock('$lib/workflows/site-tools/load-registry', () => ({
  loadToolRegistry: async () => ({
    getTools: () => [
      { name: 'site_blog_list', destructive: false, description: 'long prose', parameters: {} },
      { name: 'gmail_send', destructive: true, description: 'more prose', parameters: {} },
      { name: 'research_start' /* no flag at all */, parameters: {} },
    ],
  }),
}));

const { GET } = await import('./+server');

const TOKEN = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = {
  invoke: env.JKAI_INVOKE_TOKEN,
  url: env.JKAI_TOOL_INVOKE_URL,
  outbound: env.JKAI_TOOL_INVOKE_TOKEN,
};

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
  delete mutableEnv.JKAI_TOOL_INVOKE_URL;
  delete mutableEnv.JKAI_TOOL_INVOKE_TOKEN;
});

afterAll(() => {
  for (const [key, value] of [
    ['JKAI_INVOKE_TOKEN', original.invoke],
    ['JKAI_TOOL_INVOKE_URL', original.url],
    ['JKAI_TOOL_INVOKE_TOKEN', original.outbound],
  ] as const) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
});

function req(token?: string): Request {
  return new Request('https://example.test/api/platform/tools/catalogue', {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function call(token?: string) {
  try {
    const response = (await GET({ request: req(token) } as never)) as Response;
    return { status: response.status, body: await response.json() };
  } catch (e) {
    const httpError = e as { status?: number };
    if (!httpError.status) throw e;
    return { status: httpError.status, body: null };
  }
}

describe('GET /api/platform/tools/catalogue', () => {
  it('lists every tool with its destructive flag', async () => {
    const { status, body } = await call(TOKEN);
    expect(status).toBe(200);
    expect(body.tools).toEqual([
      { name: 'site_blog_list', destructive: false },
      { name: 'gmail_send', destructive: true },
      { name: 'research_start', destructive: false },
    ]);
  });

  // Not the manifest. A chat process composing a prompt needs descriptions and
  // schemas and gets them elsewhere; this answers only the two questions the
  // chat LOOP asks about a name it has already been given, so there is nothing
  // here worth leaking.
  it('carries no descriptions or schemas', async () => {
    const { body } = await call(TOKEN);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('prose');
    expect(serialised).not.toContain('parameters');
  });

  it('401s without the credential', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('x'.repeat(48))).status).toBe(401);
  });

  it('401s when no credential is configured at all', async () => {
    delete mutableEnv.JKAI_INVOKE_TOKEN;
    expect((await call(TOKEN)).status).toBe(401);
  });

  /**
   * A process that delegates its own tools has no catalogue of its own worth
   * serving, and answering would let a self-pointing configuration look like it
   * works. Refusing at the door is the structural version of the comment.
   */
  it('refuses to serve when this process delegates its own tools', async () => {
    mutableEnv.JKAI_TOOL_INVOKE_URL = 'http://127.0.0.1:9/api/platform/tools/invoke';
    mutableEnv.JKAI_TOOL_INVOKE_TOKEN = 'o'.repeat(48);
    expect((await call(TOKEN)).status).toBe(409);
  });
});
