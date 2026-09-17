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
      { name: 'site_blog_list', destructive: false, description: 'list posts', parameters: { type: 'object', properties: {} }, toolset: 'blog', category: 'content' },
      { name: 'gmail_send', destructive: true, description: 'send mail', parameters: { type: 'object', properties: {} }, toolset: 'gmail', category: 'comms' },
      { name: 'research_start' /* no flag at all */, description: 'start', parameters: { type: 'object', properties: {} }, toolset: 'research', category: 'research' },
    ],
    getAvailableToolsets: () => ['blog', 'gmail', 'research'],
    getToolsetManifest: () => [{ toolset: 'blog', description: 'Blog', tools: [{ name: 'site_blog_list', description: 'list posts' }] }],
    buildSystemPromptSection: () => 'TOOLSETS: blog, gmail, research',
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
    expect(body.tools.map((t: { name: string; destructive: boolean }) => [t.name, t.destructive])).toEqual([
      ['site_blog_list', false],
      ['gmail_send', true],
      // A tool that declares nothing is not destructive — asserted rather than
      // assumed, because the flag crossing as `undefined` would read as "unknown"
      // on the far side, where unknown fails CLOSED and would confirm everything.
      ['research_start', false],
    ]);
  });

  /**
   * It IS the manifest, and that is the correction this endpoint went through.
   *
   * The first cut served names and a destructive flag, on the theory that a
   * chat process composing a prompt gets the full definitions "from the same
   * place it always did". That place is `site-tools/registry` — the barrel the
   * boundary exists to leave behind — so serving names only left the prompt
   * builder, the meta-tools and the chat loop still holding it.
   */
  it('carries the descriptions, schemas and prompt section a prompt needs', async () => {
    const { body } = await call(TOKEN);
    expect(body.tools[0].parameters).toEqual({ type: 'object', properties: {} });
    expect(body.tools[0].description).toBe('list posts');
    expect(body.toolsets).toEqual(['blog', 'gmail', 'research']);
    expect(body.manifest[0].toolset).toBe('blog');
    expect(body.promptSection).toContain('TOOLSETS');
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
