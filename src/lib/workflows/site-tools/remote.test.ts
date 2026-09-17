import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { contextForWire, invokeRemoteTool, RemoteInvokeError } from './remote';
import { coerceInvokeRequest } from './invoke-contract';

const TOKEN = 't'.repeat(48);

type Recorded = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
let recorded: Recorded | null = null;
/** Set per test: what the fake Main answers with. */
let respond: (res: http.ServerResponse) => void = (res) => res.end();

let server: http.Server;
let target: { url: string; token: string };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      respond(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  target = { url: `http://127.0.0.1:${port}/api/platform/tools/invoke`, token: TOKEN };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function ndjson(lines: string[]) {
  return (res: http.ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const line of lines) res.write(`${line}\n`);
    res.end();
  };
}

describe('contextForWire', () => {
  it('sends the six fields and nothing else', () => {
    const wire = contextForWire({
      emit: () => {},
      conversationId: 'c1',
      workflowId: null,
      jobId: 'j1',
      modelContext: { modelId: 'm' } as never,
      thinkingLevel: 'high' as never,
      allowedTools: ['a'],
      // None of these may cross — see invoke-contract.ts for why each one is
      // dangerous in a caller's hands.
      buildId: 'b1',
      iterationId: 'i1',
      depth: 3,
      busKey: 'bus',
      deadline: Date.now() + 1000,
      signal: new AbortController().signal,
    });
    expect(wire).toEqual({
      conversationId: 'c1',
      workflowId: null,
      jobId: 'j1',
      modelContext: { modelId: 'm' },
      thinkingLevel: 'high',
      allowedTools: ['a'],
    });
  });

  /**
   * The two halves of the contract have to agree, and the cheap way to know
   * they still do is to put the writer's output through the reader: anything
   * the caller sends that the callee drops is a field that silently stops
   * working.
   */
  it('produces a context the callee reads back unchanged', () => {
    const wire = contextForWire({
      emit: () => {},
      conversationId: 'c1',
      workflowId: 'w1',
      jobId: 'j1',
      modelContext: { modelId: 'm' } as never,
      thinkingLevel: 'low' as never,
      allowedTools: ['a', 'b'],
    });
    expect(coerceInvokeRequest({ name: 't', context: wire }).context).toEqual(wire);
  });

  it('omits absent fields rather than sending nulls for them', () => {
    expect(contextForWire({ emit: () => {} })).toEqual({});
    expect(contextForWire(undefined)).toEqual({});
  });
});

describe('invokeRemoteTool', () => {
  it('POSTs the contract body with the bearer credential', async () => {
    respond = ndjson(['{"result":{"success":true,"data":42}}']);
    const result = await invokeRemoteTool('site_blog_list', { limit: 2 }, { emit: () => {}, conversationId: 'c1' }, target);

    expect(result).toEqual({ success: true, data: 42 });
    expect(recorded?.method).toBe('POST');
    expect(recorded?.url).toBe('/api/platform/tools/invoke');
    expect(recorded?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(recorded?.headers.accept).toBe('application/x-ndjson');
    expect(JSON.parse(recorded!.body)).toEqual({
      name: 'site_blog_list',
      args: { limit: 2 },
      context: { conversationId: 'c1' },
    });
  });

  /**
   * The scar this repo already has, in `$lib/server/extracted-app.ts`: undici
   * silently DROPS a Host header, so a gateway that answers only for its
   * canonical host 400s every call. Main has no gateway today and a `fetch`
   * would work right now — and would break the day these calls arrive through
   * one, reading as an auth problem. Asserting the header on the wire is what
   * makes tidying this into `fetch` fail loudly instead.
   */
  it('sends the canonical Host when one is configured', async () => {
    respond = ndjson(['{"result":{"success":true}}']);
    await invokeRemoteTool('t', {}, undefined, { ...target, host: 'strangeramblings.com' });
    expect(recorded?.headers.host).toBe('strangeramblings.com');
  });

  it('defaults Host to the target when none is configured', async () => {
    respond = ndjson(['{"result":{"success":true}}']);
    await invokeRemoteTool('t', {}, undefined, target);
    expect(recorded?.headers.host).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  it('delivers statuses to emit as they arrive, before the result', async () => {
    const seen: string[] = [];
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"status":"decomposing"}\n');
      res.write('{"status":"launching browser"}\n');
      setTimeout(() => {
        // The result lands a tick later, so a status delivered only at the end
        // would show up after this assertion's window.
        res.write('{"result":{"success":true,"data":"page"}}\n');
        res.end();
      }, 20);
    };
    const result = await invokeRemoteTool('scraper_run', {}, { emit: (t) => seen.push(t) }, target);
    expect(seen).toEqual(['decomposing', 'launching browser']);
    expect(result).toEqual({ success: true, data: 'page' });
  });

  it('returns a failed ToolResult verbatim instead of throwing', async () => {
    // A tool that refuses is not a transport failure. The refusal is the answer
    // and it has to reach the model as one.
    respond = ndjson(['{"result":{"success":false,"error":"Unknown tool: nope"}}']);
    await expect(invokeRemoteTool('nope', {}, undefined, target)).resolves.toEqual({
      success: false,
      error: 'Unknown tool: nope',
    });
  });

  it('throws on a non-200, carrying the status and body', async () => {
    respond = (res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"message":"invalid token"}');
    };
    await expect(invokeRemoteTool('t', {}, undefined, target)).rejects.toThrow(RemoteInvokeError);
    await expect(invokeRemoteTool('t', {}, undefined, target)).rejects.toThrow(/401/);
  });

  it('throws when the stream ends without a result', async () => {
    respond = ndjson(['{"status":"started"}']);
    await expect(invokeRemoteTool('t', {}, undefined, target)).rejects.toThrow(/no result/i);
  });

  it('gives up at the deadline the context carries', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      // Never finishes.
    };
    await expect(
      invokeRemoteTool('t', {}, { emit: () => {}, deadline: Date.now() + 60 }, target),
    ).rejects.toThrow(/timed out/i);
  });
});

describe('a callee that answers plain JSON anyway', () => {
  /**
   * Asking for frames does not guarantee getting them — a Main that predates
   * this contract, or a proxy that normalises Accept, answers one object. The
   * failure this prevents is the misleading one: parsed as NDJSON it reports
   * "the stream ended with no result", which is what a dead process looks like.
   */
  it('reads the body as a single ToolResult', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true,"data":"plain"}');
    };
    await expect(invokeRemoteTool('t', {}, undefined, target)).resolves.toEqual({
      success: true,
      data: 'plain',
    });
  });

  it('reports an unreadable body as itself, not as a truncated stream', async () => {
    respond = (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>a proxy error page</html>');
    };
    await expect(invokeRemoteTool('t', {}, undefined, target)).rejects.toThrow(/unreadable body/i);
  });
});
