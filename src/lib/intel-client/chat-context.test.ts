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
});
