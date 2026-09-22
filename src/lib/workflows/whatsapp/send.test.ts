import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The send seam, and the guarantee it is really for.
 *
 * `WhatsAppService` can start a Baileys session. Its own comment says a second
 * one "would fight the owning process for the paired session and loop on failed
 * QR-pair attempts", and `ownsWhatsAppSession()` is what keeps that from
 * happening — a runtime check, in a process that still has the code.
 *
 * `send.ts` exists so a caller that only wants to send a message cannot reach
 * that code at all. The test that matters is the last one: the delegated path
 * must never load `./service`.
 */

// Spying on the FACTORY would not work: `import()` caches, so it runs once
// however many tests reach it. The spy is on the accessor instead, which is
// called per send.
const serviceLoaded = vi.fn(() => ({
  sendMessage: async () => ({ sent: true, messageId: 'local' }),
}));
vi.mock('./service', () => ({ getWhatsAppService: serviceLoaded }));

let owns = false;
let bridge: string | null = 'http://bridge.test';
vi.mock('$lib/workflows/service-role', () => ({ ownsWhatsAppSession: () => owns }));
vi.mock('$lib/config/whatsapp-bridge', () => ({ whatsappBridgeUrl: () => bridge }));

const { sendWhatsAppMessage } = await import('./send');

beforeEach(() => {
  serviceLoaded.mockClear();
  owns = false;
  bridge = 'http://bridge.test';
  vi.unstubAllGlobals();
});

type FetchArgs = [string, RequestInit];
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}
const argsOf = (spy: ReturnType<typeof stubFetch>, i = 0) => spy.mock.calls[i] as unknown as FetchArgs;

describe('delegated — the case every web slot is in', () => {
  it('POSTs the bridge and never loads the session owner', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ messageId: 'wamid.1' }), { status: 200 }));
    const result = await sendWhatsAppMessage('+447700900000', 'hello');

    expect(result).toEqual({ sent: true, messageId: 'wamid.1' });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = argsOf(spy);
    expect(url).toBe('http://bridge.test/send');
    expect(JSON.parse(init.body as string)).toEqual({
      chatId: '447700900000@s.whatsapp.net',
      message: 'hello',
    });
    // The guarantee.
    expect(serviceLoaded).not.toHaveBeenCalled();
  });

  it('passes a jid through untouched', async () => {
    const spy = stubFetch(() => new Response('{}', { status: 200 }));
    await sendWhatsAppMessage('123@g.us', 'hi');
    expect(JSON.parse(argsOf(spy)[1].body as string).chatId).toBe('123@g.us');
  });

  it('reports a refusing bridge rather than throwing', async () => {
    stubFetch(() => new Response('nope', { status: 503 }));
    const result = await sendWhatsAppMessage('+447700900000', 'hello');
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/503/);
    expect(serviceLoaded).not.toHaveBeenCalled();
  });

  it('reports an unreachable bridge rather than throwing', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await sendWhatsAppMessage('+447700900000', 'hello');
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/unreachable/);
    // A dead bridge must not fall back to starting a session — that is the
    // fight the delegation exists to prevent.
    expect(serviceLoaded).not.toHaveBeenCalled();
  });

  /**
   * No `state.status` gate, deliberately. In delegated mode that value is set
   * once by a boot probe and never re-probed, so a restart during an outage — a
   * CI deploy counts — pinned the channel off permanently even after the owner
   * came back. Attempt the send; the result is the truth.
   */
  it('attempts the send without consulting a cached status', async () => {
    const spy = stubFetch(() => new Response('{}', { status: 200 }));
    await sendWhatsAppMessage('+447700900000', 'hello');
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('the owner, and only the owner, reaches the session', () => {
  it('uses the local service when this process owns the session', async () => {
    owns = true;
    const spy = stubFetch(() => new Response('{}', { status: 200 }));
    const result = await sendWhatsAppMessage('+447700900000', 'hello');
    expect(result).toEqual({ sent: true, messageId: 'local' });
    expect(spy).not.toHaveBeenCalled();
    expect(serviceLoaded).toHaveBeenCalled();
  });

  // No bridge configured and not the owner either: there is nowhere to delegate
  // to, so the local path is all that is left. Homeserv in development.
  it('falls back to the local service when no bridge is configured', async () => {
    bridge = null;
    await sendWhatsAppMessage('+447700900000', 'hello');
    expect(serviceLoaded).toHaveBeenCalled();
  });
});
