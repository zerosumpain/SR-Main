import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { env } from '$env/dynamic/private';
import type { ToolExecContext, ToolResult } from '$lib/workflows/site-tools/registry-internal';

/**
 * The contract end to end: the real POST handler, on a real socket, driven by
 * the real client.
 *
 * The catalogue is the one thing faked. `site-tools/registry` imports 75 tool
 * modules for their `register()` side effects and reaches the database through
 * most of them, which is what `load-registry.ts` exists to keep off everybody's
 * static graph — pulling it in here would test the estate, not the boundary.
 * What the fake gives back is a place to stand: the tools' own arguments and
 * the context they were handed, so the assertions can be about what CROSSED.
 *
 * Enforcement of `allowedTools`, unknown names and argument schemas is
 * `registry.executeTool`'s (registry.ts:181-187) and is deliberately not
 * reproduced here — the endpoint's job is to deliver the context intact, and
 * that is what is asserted.
 */

type Recorded = { name: string; args: Record<string, unknown>; ctx?: ToolExecContext };
let calls: Recorded[] = [];

const TOOLS: Record<string, { destructive?: boolean; run: (ctx?: ToolExecContext) => ToolResult }> = {
  site_blog_list: { run: () => ({ success: true, data: ['a', 'b'] }) },
  scraper_run: {
    run: (ctx) => {
      ctx?.emit('decomposing');
      ctx?.emit('launching browser');
      ctx?.emit('finished');
      return { success: true, data: 'scraped' };
    },
  },
  gmail_send: { destructive: true, run: () => ({ success: true, data: 'sent' }) },
  always_fails: { run: () => ({ success: false, error: 'the tool said no' }) },
};

vi.mock('$lib/workflows/site-tools/load-registry', () => ({
  loadToolRegistry: async () => ({
    getTool: (name: string) => (TOOLS[name] ? { name, destructive: TOOLS[name].destructive } : undefined),
    executeTool: async (name: string, args: Record<string, unknown>, ctx?: ToolExecContext) => {
      calls.push({ name, args, ctx });
      const tool = TOOLS[name];
      if (!tool) return { success: false, error: `Unknown tool: ${name}` };
      return tool.run(ctx);
    },
  }),
}));

const { POST } = await import('./+server');
const { invokeRemoteTool, RemoteInvokeError } = await import('$lib/workflows/site-tools/remote');

const STANDARD = 's'.repeat(48);
const DESTRUCTIVE = 'd'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = {
  standard: env.JKAI_INVOKE_TOKEN,
  destructive: env.JKAI_INVOKE_DESTRUCTIVE_TOKEN,
};

let server: http.Server;
let base: string;

/** Adapts the SvelteKit handler onto a socket, including its thrown HttpErrors. */
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    let response: Response;
    try {
      response = (await POST({ request } as never)) as Response;
    } catch (e) {
      const httpError = e as { status?: number; body?: { message?: string } };
      if (!httpError.status) throw e;
      response = new Response(JSON.stringify({ message: httpError.body?.message ?? 'error' }), {
        status: httpError.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform/tools/invoke`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (original.standard === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original.standard;
  if (original.destructive === undefined) delete mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN;
  else mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = original.destructive;
});

beforeEach(() => {
  calls = [];
  mutableEnv.JKAI_INVOKE_TOKEN = STANDARD;
  delete mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN;
});

const target = () => ({ url: base, token: STANDARD });

/** A curl-equivalent, for the plain-JSON path the client never takes. */
async function raw(body: unknown, init: { token?: string; accept?: string } = {}) {
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: init.accept ?? 'application/json',
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

describe('POST /api/platform/tools/invoke', () => {
  it('runs a tool and returns the ToolResult through the real client', async () => {
    const result = await invokeRemoteTool('site_blog_list', { limit: 2 }, undefined, target());
    expect(result).toEqual({ success: true, data: ['a', 'b'] });
    expect(calls[0]).toMatchObject({ name: 'site_blog_list', args: { limit: 2 } });
  });

  /**
   * The assertion the whitelist exists for. A caller that could set `buildId`
   * would stamp its tool's writes with somebody else's provenance; one that
   * could set `depth` would have removed the recursion guard; one that could
   * set `busKey` would be addressing another chat's confirmer.
   */
  it('delivers the six context fields and drops the four that must not cross', async () => {
    await invokeRemoteTool(
      'site_blog_list',
      {},
      {
        emit: () => {},
        conversationId: 'c1',
        workflowId: null,
        jobId: 'j1',
        modelContext: { modelId: 'claude-opus-5' } as never,
        thinkingLevel: 'high' as never,
        allowedTools: ['site_blog_list'],
        buildId: 'someone-elses-build',
        iterationId: 'i9',
        depth: 0,
        busKey: 'someone-elses-chat',
      },
      target(),
    );
    const ctx = calls[0].ctx!;
    expect(ctx.conversationId).toBe('c1');
    expect(ctx.workflowId).toBeNull();
    expect(ctx.jobId).toBe('j1');
    expect(ctx.modelContext).toEqual({ modelId: 'claude-opus-5' });
    expect(ctx.thinkingLevel).toBe('high');
    expect(ctx.allowedTools).toEqual(['site_blog_list']);
    expect(ctx.buildId).toBeUndefined();
    expect(ctx.iterationId).toBeUndefined();
    expect(ctx.depth).toBeUndefined();
    expect(ctx.busKey).toBeUndefined();
  });

  it('streams every emit before the result, in order', async () => {
    const seen: string[] = [];
    const result = await invokeRemoteTool('scraper_run', {}, { emit: (t) => seen.push(t) }, target());
    expect(seen).toEqual(['decomposing', 'launching browser', 'finished']);
    expect(result).toEqual({ success: true, data: 'scraped' });
  });

  it('passes a tool refusal back as a result, not as a transport failure', async () => {
    await expect(invokeRemoteTool('always_fails', {}, undefined, target())).resolves.toEqual({
      success: false,
      error: 'the tool said no',
    });
  });

  it('reports an unknown tool the way the registry does', async () => {
    await expect(invokeRemoteTool('no_such_tool', {}, undefined, target())).resolves.toEqual({
      success: false,
      error: 'Unknown tool: no_such_tool',
    });
  });

  describe('the destructive lane', () => {
    it('refuses a destructive tool on the standard credential, without running it', async () => {
      const result = await invokeRemoteTool('gmail_send', { to: 'x' }, undefined, target());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/needs confirming/i);
      expect(result.error).toMatch(/\/jkai/);
      expect(calls).toHaveLength(0);
    });

    it('runs it once the second credential is configured and presented', async () => {
      mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
      await expect(
        invokeRemoteTool('gmail_send', { to: 'x' }, undefined, { url: base, token: DESTRUCTIVE }),
      ).resolves.toEqual({ success: true, data: 'sent' });
      expect(calls).toHaveLength(1);
    });

    // The half that matters: configuring the lane does not open it to the
    // credential that was already there.
    it('still refuses the standard credential once the lane exists', async () => {
      mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
      const result = await invokeRemoteTool('gmail_send', { to: 'x' }, undefined, target());
      expect(result.success).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('lets the destructive credential run ordinary tools too', async () => {
      mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
      await expect(
        invokeRemoteTool('site_blog_list', {}, undefined, { url: base, token: DESTRUCTIVE }),
      ).resolves.toEqual({ success: true, data: ['a', 'b'] });
    });
  });

  describe('credentials', () => {
    it.each([
      ['no credential', undefined],
      ['a wrong one', 'x'.repeat(48)],
      ['one below the length floor', 'short'],
    ])('401s on %s', async (_label, token) => {
      expect((await raw({ name: 'site_blog_list' }, { token })).status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it('401s through the client too, as a thrown error rather than a result', async () => {
      await expect(
        invokeRemoteTool('site_blog_list', {}, undefined, { url: base, token: 'x'.repeat(48) }),
      ).rejects.toThrow(RemoteInvokeError);
    });

    it('closes completely when no token is configured', async () => {
      delete mutableEnv.JKAI_INVOKE_TOKEN;
      expect((await raw({ name: 'site_blog_list' }, { token: STANDARD })).status).toBe(401);
    });
  });

  describe('malformed requests', () => {
    it.each([
      ['no name', { args: {} }],
      ['a non-string name', { name: 7 }],
      ['args that are not an object', { name: 't', args: [1] }],
    ])('400s on %s', async (_label, body) => {
      expect((await raw(body, { token: STANDARD })).status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('400s on a body that is not JSON', async () => {
      expect((await raw('{oh no', { token: STANDARD })).status).toBe(400);
    });
  });

  describe('the plain-JSON default', () => {
    it('answers a single JSON object when NDJSON is not asked for', async () => {
      const res = await raw({ name: 'site_blog_list' }, { token: STANDARD });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, data: ['a', 'b'] });
    });

    // Same tool, both shapes: the emits simply go nowhere, which is what the
    // 137 tools that never emit get anyway.
    it('runs an emitting tool fine and drops its captions', async () => {
      const res = await raw({ name: 'scraper_run' }, { token: STANDARD });
      expect(JSON.parse(res.body)).toEqual({ success: true, data: 'scraped' });
    });
  });
});
