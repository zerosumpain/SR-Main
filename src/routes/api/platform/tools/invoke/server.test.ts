import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { env } from '$env/dynamic/private';
import type { ToolExecContext, ToolResult } from '$lib/tools/registry-internal';

/**
 * The contract end to end: the real POST handler, on a real socket, driven by
 * the real client.
 *
 * Deliberately NOT named `*.integration.test.ts`. That suffix means "needs a
 * database", and the merge gate excludes the whole lane — 46 files a pull
 * request never executes, which `tests/scripts/coverage-census.test.ts` exists
 * to make you notice. This needs nothing but a loopback socket, and it is the
 * test that caught the destructive refusal answering the wrong content type, so
 * it belongs where every PR runs it.
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

const TOOLS: Record<string, { destructive?: boolean; lane?: string; effect?: string; run: (ctx?: ToolExecContext) => ToolResult }> = {
  develop_commission: { effect: 'mutate', lane: 'commission', run: () => ({ success: true, data: { buildId: 'b1' } }) },
  site_blog_list: { effect: 'read', run: () => ({ success: true, data: ['a', 'b'] }) },
  scraper_run: {
    effect: 'read',
    run: (ctx) => {
      ctx?.emit('decomposing');
      ctx?.emit('launching browser');
      ctx?.emit('finished');
      return { success: true, data: 'scraped' };
    },
  },
  gmail_send: { effect: 'destructive', destructive: true, run: () => ({ success: true, data: 'sent' }) },
  always_fails: { effect: 'read', run: () => ({ success: false, error: 'the tool said no' }) },
  // Declares no effect: fails closed onto the destructive lane.
  undeclared_tool: { run: () => ({ success: true, data: 'ran' }) },
};

vi.mock('$lib/tools/load-registry', () => ({
  loadToolRegistry: async () => ({
    getTool: (name: string) =>
      TOOLS[name] ? { name, destructive: TOOLS[name].destructive, effect: TOOLS[name].effect, lane: TOOLS[name].lane } : undefined,
    executeTool: async (name: string, args: Record<string, unknown>, ctx?: ToolExecContext) => {
      calls.push({ name, args, ctx });
      const tool = TOOLS[name];
      if (!tool) return { success: false, error: `Unknown tool: ${name}` };
      return tool.run(ctx);
    },
  }),
}));

const principals = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));
vi.mock('$lib/jkai/principal/record.server', () => ({
  recordInvocationPrincipal: (rec: Record<string, unknown>) => principals.recorded.push(rec),
}));

const { POST } = await import('./+server');
const { invokeRemoteTool, RemoteInvokeError } = await import('$lib/tools/remote');
const { sealPrincipal } = await import('$lib/tools/principal-seal');

const STANDARD = 's'.repeat(48);
const KEY = 'k'.repeat(40);
const DESTRUCTIVE = 'd'.repeat(48);
const COMMISSION = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = {
  standard: env.JKAI_INVOKE_TOKEN,
  destructive: env.JKAI_INVOKE_DESTRUCTIVE_TOKEN,
  commission: env.JKAI_INVOKE_COMMISSION_TOKEN,
  key: env.JKAI_PRINCIPAL_KEY,
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
  if (original.commission === undefined) delete mutableEnv.JKAI_INVOKE_COMMISSION_TOKEN;
  else mutableEnv.JKAI_INVOKE_COMMISSION_TOKEN = original.commission;
  if (original.key === undefined) delete mutableEnv.JKAI_PRINCIPAL_KEY;
  else mutableEnv.JKAI_PRINCIPAL_KEY = original.key;
});

beforeEach(() => {
  calls = [];
  principals.recorded = [];
  mutableEnv.JKAI_INVOKE_TOKEN = STANDARD;
  mutableEnv.JKAI_PRINCIPAL_KEY = KEY;
  delete mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN;
  delete mutableEnv.JKAI_INVOKE_COMMISSION_TOKEN;
});

const target = () => ({ url: base, token: STANDARD, audience: 'sr-main' as const });
const OWNER_SESSION = { principalId: 'owner', via: 'session' as const, attended: true, jobId: 'job-1' };
/** A body for `raw`, sealed for its tool as Core would seal it. */
const sealed = (name: string, principal: Parameters<typeof sealPrincipal>[0] = OWNER_SESSION, extra: Record<string, unknown> = {}) => ({
  name,
  context: { principal: sealPrincipal(principal, { key: KEY, aud: 'sr-main', tool: name }), ...extra },
});

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
    expect(ctx.modelContext).toEqual({ provider: 'openrouter', modelId: 'claude-opus-5' });
    expect(ctx.thinkingLevel).toBe('high');
    expect(ctx.allowedTools).toEqual(['site_blog_list']);
    expect(ctx.buildId).toBeUndefined();
    expect(ctx.iterationId).toBeUndefined();
    expect(ctx.depth).toBeUndefined();
    expect(ctx.busKey).toBeUndefined();
  });

  /**
   * `coerceModelContext` is this codebase's single decider of provider, and it
   * reads the id PREFIX rather than the field. Running it on arrival means a
   * caller cannot hand Main a mismatched pair — which matters because the tools
   * that read this write it onto a row a sidecar picks up hours later, with no
   * ambient context left to correct it.
   */
  it('derives the provider from the model id, not from what the caller claimed', async () => {
    await invokeRemoteTool(
      'site_blog_list',
      {},
      { emit: () => {}, modelContext: { provider: 'openrouter', modelId: 'codex/gpt-5.6-terra' } as never },
      target(),
    );
    expect(calls[0].ctx!.modelContext).toEqual({
      provider: 'codex',
      modelId: 'codex/gpt-5.6-terra',
    });
  });

  it('drops a model context with no id rather than passing a half one on', async () => {
    await invokeRemoteTool(
      'site_blog_list',
      {},
      { emit: () => {}, modelContext: { provider: 'codex' } as never },
      target(),
    );
    expect(calls[0].ctx!.modelContext).toBeUndefined();
  });

  it('refuses a thinking level that is not on the ladder', async () => {
    await invokeRemoteTool(
      'site_blog_list',
      {},
      { emit: () => {}, thinkingLevel: 'ultra-mega' as never },
      target(),
    );
    expect(calls[0].ctx!.thinkingLevel).toBeNull();
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

  describe('principal phase 1 (logging only)', () => {
    it('records each call with its lane and the context it arrived with', async () => {
      await invokeRemoteTool(
        'site_blog_list',
        {},
        { emit: () => {}, jobId: 'job-1', conversationId: 'conv-1', principalId: 'owner', allowedTools: ['site_blog_list'] },
        target(),
      );
      expect(principals.recorded).toEqual([
        {
          tool: 'site_blog_list',
          lane: 'standard',
          principalId: 'owner',
          jobId: 'job-1',
          conversationId: 'conv-1',
          allowedTools: ['site_blog_list'],
          // A context with no principal is sealed as an unattended service call.
          signed: { via: 'service', attended: false },
        },
      ]);
    });

    it('records a call the lane then refuses, without changing the refusal', async () => {
      const result = await invokeRemoteTool('gmail_send', { to: 'x' }, undefined, target());
      expect(result.success).toBe(false);
      expect(calls).toHaveLength(0);
      expect(principals.recorded).toMatchObject([{ tool: 'gmail_send', lane: 'standard' }]);
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
        invokeRemoteTool('gmail_send', { to: 'x' }, undefined, { url: base, token: DESTRUCTIVE, audience: 'sr-main' as const }),
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

    it('treats a tool that declares no effect as destructive: refused on the standard credential, unrun', async () => {
      const result = await invokeRemoteTool('undeclared_tool', {}, undefined, target());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/needs confirming/i);
      expect(calls).toHaveLength(0);
    });

    it('lets the destructive credential run ordinary tools too', async () => {
      mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
      await expect(
        invokeRemoteTool('site_blog_list', {}, undefined, { url: base, token: DESTRUCTIVE, audience: 'sr-main' as const }),
      ).resolves.toEqual({ success: true, data: ['a', 'b'] });
    });
  });

  describe('the commission lane (slice 6b)', () => {
    const on = (token: string) => ({ url: base, token, audience: 'sr-main' as const });
    const session = { emit: () => {}, jobId: 'job-1', principal: OWNER_SESSION };
    beforeEach(() => {
      mutableEnv.JKAI_INVOKE_DESTRUCTIVE_TOKEN = DESTRUCTIVE;
      mutableEnv.JKAI_INVOKE_COMMISSION_TOKEN = COMMISSION;
    });

    it('carries develop_commission on the commission token, marked so executeTool can open the lane', async () => {
      await expect(invokeRemoteTool('develop_commission', { outcome: 'x' }, session, on(COMMISSION))).resolves.toEqual({ success: true, data: { buildId: 'b1' } });
      expect(calls).toHaveLength(1);
      expect(calls[0].ctx?.credentialLane).toBe('commission');
      expect(calls[0].ctx?.principal).toMatchObject({ principalId: 'owner', via: 'session', attended: true });
    });

    it('opens nothing else: a read and a destructive tool are refused on it, unrun', async () => {
      for (const name of ['site_blog_list', 'gmail_send']) {
        const result = await invokeRemoteTool(name, {}, session, on(COMMISSION));
        expect(result.success, name).toBe(false);
        expect(result.error).toMatch(/opens only commissioning/);
      }
      expect(calls).toHaveLength(0);
    });

    it('is not opened by the destructive or the standard token', async () => {
      for (const token of [DESTRUCTIVE, STANDARD]) {
        const result = await invokeRemoteTool('develop_commission', { outcome: 'x' }, session, on(token));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/commission lane .* closed/);
      }
      expect(calls).toHaveLength(0);
    });

    it('401s a missing token and an unset lane', async () => {
      expect((await raw(sealed('develop_commission'))).status).toBe(401);
      delete mutableEnv.JKAI_INVOKE_COMMISSION_TOKEN;
      expect((await raw(sealed('develop_commission'), { token: COMMISSION })).status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it('still needs the seal: no principal is 401', async () => {
      expect((await raw({ name: 'develop_commission' }, { token: COMMISSION })).status).toBe(401);
    });

    it('stamps the other lanes as what they are', async () => {
      await invokeRemoteTool('site_blog_list', {}, session, target());
      expect(calls[0].ctx?.credentialLane).toBe('standard');
    });
  });

  describe('principal phase 2 (the seal)', () => {
    it('401s a call with no principal, without running it', async () => {
      const res = await raw({ name: 'site_blog_list' }, { token: STANDARD });
      expect(res.status).toBe(401);
      expect(res.body).toMatch(/principal missing/);
      expect(calls).toHaveLength(0);
    });

    it('503s every call when JKAI_PRINCIPAL_KEY is unset: there is no unsigned mode', async () => {
      delete mutableEnv.JKAI_PRINCIPAL_KEY;
      expect((await raw(sealed('site_blog_list'), { token: STANDARD })).status).toBe(503);
      mutableEnv.JKAI_PRINCIPAL_KEY = 'short';
      expect((await raw(sealed('site_blog_list'), { token: STANDARD })).status).toBe(503);
      expect(calls).toHaveLength(0);
    });

    it('401s a seal made with another key', async () => {
      const forged = { name: 'site_blog_list', context: { principal: sealPrincipal(OWNER_SESSION, { key: 'f'.repeat(40), aud: 'sr-main', tool: 'site_blog_list' }) } };
      const res = await raw(forged, { token: STANDARD });
      expect(res.status).toBe(401);
      expect(res.body).toMatch(/signature/);
    });

    it('401s a seal whose claims were edited after signing', async () => {
      const good = sealPrincipal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: ['render_table'] }, { key: KEY, aud: 'sr-main', tool: 'site_blog_list' })!;
      const [body, mac] = good.split('.');
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      const edited = Buffer.from(JSON.stringify({ ...claims, principalId: 'owner', allowedTools: undefined })).toString('base64url');
      expect((await raw({ name: 'site_blog_list', context: { principal: `${edited}.${mac}` } }, { token: STANDARD })).status).toBe(401);
    });

    it('401s an expired seal', async () => {
      const old = sealPrincipal(OWNER_SESSION, { key: KEY, aud: 'sr-main', tool: 'site_blog_list', now: Date.now() - 10 * 60_000 });
      const res = await raw({ name: 'site_blog_list', context: { principal: old } }, { token: STANDARD });
      expect(res.status).toBe(401);
      expect(res.body).toMatch(/expired/);
    });

    it('401s a seal for another receiver or another tool', async () => {
      const workflows = sealPrincipal(OWNER_SESSION, { key: KEY, aud: 'sr-workflows', tool: 'site_blog_list' });
      expect((await raw({ name: 'site_blog_list', context: { principal: workflows } }, { token: STANDARD })).body).toMatch(/audience/);
      const other = sealPrincipal(OWNER_SESSION, { key: KEY, aud: 'sr-main', tool: 'site_blog_list' });
      expect((await raw({ name: 'gmail_send', context: { principal: other } }, { token: STANDARD })).body).toMatch(/principal tool/);
      expect(calls).toHaveLength(0);
    });

    it('opens a seal once: a replay is refused', async () => {
      const body = sealed('site_blog_list');
      expect((await raw(body, { token: STANDARD })).status).toBe(200);
      const again = await raw(body, { token: STANDARD });
      expect(again.status).toBe(401);
      expect(again.body).toMatch(/replay/);
      expect(calls).toHaveLength(1);
    });

    it('takes who the call is for from the seal, never from the body', async () => {
      const member = { principalId: 'u_member', via: 'session' as const, attended: true, jobId: 'job-9', allowedTools: ['render_table'] };
      await raw(sealed('site_blog_list', member, { principalId: 'owner', allowedTools: ['site_blog_list', 'gmail_send'] }), { token: STANDARD });
      const ctx = calls[0].ctx!;
      expect(ctx.principalId).toBe('u_member');
      // The body list could only narrow the sealed one: nothing in common, nothing allowed.
      expect(ctx.allowedTools).toEqual([]);
      expect(ctx.principal).toMatchObject({ principalId: 'u_member', via: 'session', attended: true, jobId: 'job-9' });
    });

    it('recomputes attended: a hands-free surface or a service via is never attended', async () => {
      await raw(sealed('site_blog_list', { ...OWNER_SESSION, surface: 'siri' }), { token: STANDARD });
      await raw(sealed('site_blog_list', { principalId: 'owner', via: 'whatsapp', attended: true, jobId: 'j' }), { token: STANDARD });
      expect(calls.map((c) => c.ctx!.principal!.attended)).toEqual([false, false]);
    });

    it('401s a seal for a different job than the call names', async () => {
      const res = await raw(sealed('site_blog_list', OWNER_SESSION, { jobId: 'someone-elses-job' }), { token: STANDARD });
      expect(res.status).toBe(401);
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
      const res = await raw(sealed('site_blog_list'), { token: STANDARD });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, data: ['a', 'b'] });
    });

    // Same tool, both shapes: the emits simply go nowhere, which is what the
    // 137 tools that never emit get anyway.
    it('runs an emitting tool fine and drops its captions', async () => {
      const res = await raw(sealed('scraper_run'), { token: STANDARD });
      expect(JSON.parse(res.body)).toEqual({ success: true, data: 'scraped' });
    });
  });
  describe('guards the bypass leaves to it', () => {
    /**
     * `depth` is deliberately not on the wire, so `executeTool`'s recursion
     * guard cannot span a hop — and the workflow-engine nodes DO re-enter the
     * seam (`nodes/jkai.ts`, `deep-research`, `deep-dive`). A self-pointing
     * configuration would therefore go round again with the depth reset each
     * pass. One refusal at the door ends that structurally.
     */
    it('refuses to serve when this process delegates its own tools', async () => {
      mutableEnv.JKAI_TOOL_INVOKE_URL = 'http://127.0.0.1:9/api/platform/tools/invoke';
      mutableEnv.JKAI_TOOL_INVOKE_TOKEN = 'o'.repeat(48);
      try {
        expect((await raw({ name: 'site_blog_list' }, { token: STANDARD })).status).toBe(409);
        expect(calls).toHaveLength(0);
      } finally {
        delete mutableEnv.JKAI_TOOL_INVOKE_URL;
        delete mutableEnv.JKAI_TOOL_INVOKE_TOKEN;
      }
    });

    /**
     * The hook bypass returns before the RATE_LIMITS pass, so a bypassed route
     * has to bring its own ceiling — `/api/jkai/studio` says the same thing
     * fifteen lines away in hooks.server.ts. This is a runaway guard, not a
     * security control: a leaked token already has the catalogue. It is set
     * well above what a chat turn does and only bites a retry loop.
     *
     * LAST in the file on purpose — the bucket is module-global and keyed by
     * route, so exhausting it here would rate-limit anything that ran after.
     */
    it('has a ceiling, because the bypass skips the limiter', async () => {
      let limited = 0;
      for (let i = 0; i < 700; i++) {
        const res = await raw({ name: 'site_blog_list' }, { token: STANDARD });
        if (res.status === 429) limited++;
      }
      expect(limited).toBeGreaterThan(0);
    });
  });
});
