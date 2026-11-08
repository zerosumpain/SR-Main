import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
vi.mock('$lib/server/extracted-app', () => ({ postToExtracted: (...a: unknown[]) => post(...a) }));

const { chatTurn } = await import('./turn');

const modelContext = { provider: 'openrouter', modelId: 'm' } as never;

beforeEach(() => post.mockReset());

describe('chatTurn', () => {
  it("posts the turn to Core's service route, attachments by id", async () => {
    post.mockResolvedValue({ response: 'hi', memory: { k: 1 } });
    const out = await chatTurn(
      { text: 'hello', attachments: [{ id: 'a1' }] },
      [{ role: 'user', content: 'earlier', createdAt: new Date('2026-10-01T10:00:00.000Z'), attachments: [{ id: 'h1', diskPath: '/x' } as never] }],
      { conversationId: 'c1', modelContext, priceSnapshot: null },
    );
    expect(out).toEqual({ response: 'hi', memory: { k: 1 }, identityVersion: null, confirm: null });
    const [app, path, body] = post.mock.calls[0];
    expect(app).toBe('jkai-core');
    expect(path).toBe('/api/jkai/service/turn');
    expect(body).toEqual({
      input: { text: 'hello', attachmentIds: ['a1'] },
      history: [{ role: 'user', content: 'earlier', createdAt: '2026-10-01T10:00:00.000Z', attachmentIds: ['h1'] }],
      options: { conversationId: 'c1', modelContext, priceSnapshot: null },
    });
  });

  it('sends the envelope and reads back which soul answered', async () => {
    post.mockResolvedValue({ response: 'ok', identityVersion: 'v3:abc' });
    const out = await chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null, envelope: { surface: 'whatsapp' } });
    expect(post.mock.calls[0][2].options.envelope).toEqual({ surface: 'whatsapp' });
    expect(out.identityVersion).toBe('v3:abc');
  });

  it('reads back a call Core froze for a reply code, strictly', async () => {
    post.mockResolvedValue({ response: 'ok', confirm: { tool: 'ha_call_service', args: { domain: 'light' }, prompt: 'Turn it off?' } });
    const out = await chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null, confirmByCode: ['ha_call_service'] });
    expect(post.mock.calls[0][2].options.confirmByCode).toEqual(['ha_call_service']);
    expect(out.confirm).toEqual({ tool: 'ha_call_service', args: { domain: 'light' }, prompt: 'Turn it off?' });
    for (const confirm of [{ tool: 'x y', args: {} }, { tool: 'ha_call_service', args: [] }, { tool: 'ha_call_service' }, 'ha_call_service']) {
      post.mockResolvedValue({ response: 'ok', confirm });
      expect((await chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null })).confirm).toBeNull();
    }
  });

  it('omits attachmentIds when there are none', async () => {
    post.mockResolvedValue({ response: 'ok' });
    await chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null });
    expect(post.mock.calls[0][2].input).toEqual({ text: 't' });
  });

  it('throws when Core answers without a response, so the caller can say so', async () => {
    post.mockResolvedValue({});
    await expect(chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null })).rejects.toThrow(/no response/);
  });

  it('gives a turn minutes, not the 4s default', async () => {
    post.mockResolvedValue({ response: 'ok' });
    await chatTurn({ text: 't' }, [], { modelContext, priceSnapshot: null });
    expect(post.mock.calls[0][3].timeoutMs).toBeGreaterThanOrEqual(600_000);
  });
});
