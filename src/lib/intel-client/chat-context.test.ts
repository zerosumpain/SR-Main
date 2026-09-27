import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { chatContext } from './chat-context';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  delete process.env.JKAI_INVOKE_TOKEN;
  vi.restoreAllMocks();
});

function stub(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as import('node:net').AddressInfo).port));
  });
}

describe('chatContext', () => {
  it("POSTs the turn to Core's chat-context lane with the invoke token and returns both blocks", async () => {
    process.env.JKAI_INVOKE_TOKEN = 't'.repeat(40);
    let seen: { method?: string; url?: string; headers?: http.IncomingHttpHeaders; body?: string } = {};
    const port = await stub((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = { method: req.method, url: req.url, headers: req.headers, body };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"knowledge":"K","grounding":"G"}');
      });
    });

    const out = await chatContext({ userMessage: ' who is Ada ', entityIds: ['e1'] }, { port });

    expect(out).toEqual({ knowledge: 'K', grounding: 'G' });
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/jkai/intel/chat-context');
    expect(seen.headers?.host).toBe('strangeramblings.com');
    expect(seen.headers?.authorization).toBe(`Bearer ${'t'.repeat(40)}`);
    expect(JSON.parse(seen.body ?? '')).toEqual({ userMessage: 'who is Ada', entityIds: ['e1'] });
  });

  it('degrades to empty context when Core errors, and never throws', async () => {
    process.env.JKAI_INVOKE_TOKEN = 't'.repeat(40);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const port = await stub((_req, res) => {
      res.writeHead(502);
      res.end('bad gateway');
    });
    await expect(chatContext({ userMessage: 'a' }, { port })).resolves.toEqual({ knowledge: '', grounding: '' });
    await expect(chatContext({ userMessage: 'b' }, { port })).resolves.toEqual({ knowledge: '', grounding: '' });
    // Once per outage, not once per turn.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('degrades to empty context when the token is not configured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(chatContext({ userMessage: 'a' }, { port: 1 })).resolves.toEqual({ knowledge: '', grounding: '' });
  });

  it("never asks for a member's turn: Core answers a tokened call from the owner's graph", async () => {
    process.env.JKAI_INVOKE_TOKEN = 't'.repeat(40);
    let called = false;
    const port = await stub((_req, res) => {
      called = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"knowledge":"owner things","grounding":""}');
    });
    const out = await chatContext({ userMessage: 'a', scope: ['u_1', 'household'] }, { port });
    expect(out).toEqual({ knowledge: '', grounding: '' });
    expect(called).toBe(false);
  });

  /** A Core stub that records each body and answers with `reply(body)`. */
  async function core(reply: (body: Record<string, unknown>) => Record<string, unknown>) {
    process.env.JKAI_INVOKE_TOKEN = 't'.repeat(40);
    const bodies: Record<string, unknown>[] = [];
    const port = await stub((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        bodies.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply(body)));
      });
    });
    return { port, bodies };
  }

  it("names the member on a member's turn, and takes Core's member-scoped answer", async () => {
    const { port, bodies } = await core((b) => ({ knowledge: `for ${b.principal}`, grounding: '', principal: b.principal }));
    const out = await chatContext({ userMessage: 'a', scope: ['u_1', 'household'], principal: 'u_1' }, { port });
    expect(bodies).toEqual([{ userMessage: 'a', entityIds: [], principal: 'u_1' }]);
    expect(out).toEqual({ knowledge: 'for u_1', grounding: '' });
  });

  it("does not send a principal on the owner's turn", async () => {
    const { port, bodies } = await core(() => ({ knowledge: 'K', grounding: '' }));
    await chatContext({ userMessage: 'a' }, { port });
    await chatContext({ userMessage: 'b', principal: 'owner' }, { port });
    await chatContext({ userMessage: 'c', principal: null }, { port });
    expect(bodies.map((b) => 'principal' in b)).toEqual([false, false, false]);
  });

  it('drops the answer of a Core that ignored the principal (no echo = the owner\'s graph)', async () => {
    const { port, bodies } = await core(() => ({ knowledge: 'owner things', grounding: 'owner grounding' }));
    const out = await chatContext({ userMessage: 'a', principal: 'u_1' }, { port });
    expect(bodies).toHaveLength(1);
    expect(out).toEqual({ knowledge: '', grounding: '' });
  });

  it('drops an answer that echoes a different principal', async () => {
    const { port } = await core(() => ({ knowledge: 'someone else', grounding: '', principal: 'u_2' }));
    expect(await chatContext({ userMessage: 'a', principal: 'u_1' }, { port })).toEqual({ knowledge: '', grounding: '' });
  });
});
