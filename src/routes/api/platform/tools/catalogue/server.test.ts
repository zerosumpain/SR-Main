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

vi.mock('$lib/tools/load-registry', () => ({
  loadToolRegistry: async () => ({
    getTools: () => [
      { name: 'site_blog_list', effect: 'read', destructive: false, description: 'list posts', parameters: { type: 'object', properties: {} }, toolset: 'blog', category: 'content' },
      { name: 'gmail_send', effect: 'destructive', destructive: true, description: 'send mail', parameters: { type: 'object', properties: {} }, toolset: 'gmail', category: 'comms' },
      { name: 'research_start' /* no flag at all */, description: 'start', parameters: { type: 'object', properties: {} }, toolset: 'research', category: 'research' },
      { name: 'f1_driver_standings', effect: 'read', description: 'standings', parameters: { type: 'object', properties: {} }, toolset: 'custom:sports', category: 'Custom Tool' },
    ],
    getAvailableToolsets: () => ['blog', 'gmail', 'research', 'custom:sports'],
    getToolsetManifest: () => [
      { toolset: 'blog', description: 'Blog', tools: [{ name: 'site_blog_list', description: 'list posts' }] },
      { toolset: 'custom:sports', description: 'Saved', tools: [{ name: 'f1_driver_standings', description: 'standings' }] },
    ],
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

function req(token?: string, query = ''): Request {
  return new Request(`https://example.test/api/platform/tools/catalogue${query}`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function call(token?: string, query = '') {
  try {
    const request = req(token, query);
    const response = (await GET({ request, url: new URL(request.url) } as never)) as Response;
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
      // A tool that declares no effect fails CLOSED: served as destructive,
      // flag and tier both, never derived as a read.
      ['research_start', true],
      ['f1_driver_standings', false],
    ]);
  });

  it('serves an explicit tier on every row, destructive for the undeclared one', async () => {
    const { body } = await call(TOKEN);
    for (const t of body.tools) expect(['read', 'mutate', 'destructive'], t.name).toContain(t.effect);
    expect(body.tools.find((t: { name: string }) => t.name === 'research_start')).toMatchObject({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
    expect(body.tools.find((t: { name: string }) => t.name === 'site_blog_list')).toMatchObject({ effect: 'read', confirm: 'never', lane: 'standard' });
  });

  // Slice 7b: the manifest rides the catalogue, and a re-enabled custom tool
  // is on the owner's catalogue but not on the unattended one.
  it('serves the capability manifest with its version', async () => {
    const { body } = await call(TOKEN);
    expect(body.capabilitiesVersion).toMatch(/^c1-[0-9a-f]{8}$/);
    const ids = body.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['trips', 'family', 'custom']));
    expect(body.capabilities.find((c: { id: string }) => c.id === 'family')).toMatchObject({ status: 'planned', tools: expect.any(Array), pages: ['/home'] });
  });

  it('leaves custom tools out of the unattended audience', async () => {
    const owner = await call(TOKEN);
    expect(owner.body.tools.map((t: { name: string }) => t.name)).toContain('f1_driver_standings');
    expect(owner.body.toolsets).toContain('custom:sports');
    const unattended = await call(TOKEN, '?audience=unattended');
    expect(unattended.body.tools.map((t: { name: string }) => t.name)).not.toContain('f1_driver_standings');
    expect(unattended.body.toolsets).not.toContain('custom:sports');
    expect(unattended.body.manifest.map((m: { toolset: string }) => m.toolset)).toEqual(['blog']);
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
    expect(body.toolsets).toEqual(['blog', 'gmail', 'research', 'custom:sports']);
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
