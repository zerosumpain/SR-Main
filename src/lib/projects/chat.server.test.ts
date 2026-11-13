import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  requireProjectPublic: vi.fn(),
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 19, retryAfterMs: 0 })),
  resolveProjectChatModel: vi.fn(async () => 'test/model'),
  withActivity: vi.fn(async (_name: string, run: () => Promise<Response>) => run()),
}));

vi.mock('$lib/context/activity', () => ({ withActivity: mocks.withActivity }));
vi.mock('$lib/projects/guard', () => ({ requireProjectPublic: mocks.requireProjectPublic }));
vi.mock('$lib/server/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveProjectChatModel: mocks.resolveProjectChatModel,
}));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => ({
    client: { chat: { completions: { create: mocks.create } } },
    model: 'resolved/model',
  })),
}));

import { createProjectChatHandler } from './chat.server';

function event(body: Record<string, unknown>): RequestEvent {
  return {
    request: new Request('http://localhost/projects/example/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.8' },
      body: JSON.stringify(body),
    }),
    getClientAddress: () => '127.0.0.1',
  } as RequestEvent;
}

describe('createProjectChatHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 19, retryAfterMs: 0 });
    mocks.create.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Grounded answer' } }] };
    })());
  });

  it('guards, scopes, retrieves, and streams a project answer', async () => {
    const retrieve = vi.fn(() => [{
      title: 'Evidence',
      text: 'A grounded passage',
      url: 'https://example.test/evidence',
      sourceType: 'report',
    }]);
    const handler = createProjectChatHandler({
      slug: 'example',
      systemPrompt: 'Stay inside the example project.',
      retrieve,
      supplement: ({ body }) => `\n\nCURRENT SCENARIO: ${body.scenario}`,
    });

    const response = await handler(event({
      question: 'What changed?',
      scenario: 'Option A',
      history: [{ role: 'assistant', content: 'Earlier answer' }],
    }));

    expect(mocks.requireProjectPublic).toHaveBeenCalledWith('example', expect.anything());
    // Per visitor, per project site-wide, and a daily pool — all three spent.
    const keys = mocks.rateLimit.mock.calls.map((call) => (call as unknown[])[0]);
    expect(keys).toEqual([
      expect.stringMatching(/^public:client:project-chat:example:[0-9a-f]{24}$/),
      'public:global:project-chat:example',
      'public:daily:project-chat:example',
    ]);
    // The request body travels with the question so a project can retrieve by
    // ids the page found rather than by searching server-side.
    expect(retrieve).toHaveBeenCalledWith('What changed?', 10, expect.objectContaining({ question: 'What changed?' }));
    expect(mocks.withActivity).toHaveBeenCalledWith('project-chat', expect.any(Function));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'resolved/model',
        messages: [
          { role: 'system', content: 'Stay inside the example project.' },
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('CURRENT SCENARIO: Option A'),
          }),
        ],
        stream: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    await expect(response.text()).resolves.toContain('Grounded answer');
  });

  it('rejects an empty question before retrieval or model spend', async () => {
    const retrieve = vi.fn(() => []);
    const handler = createProjectChatHandler({
      slug: 'example',
      systemPrompt: 'System',
      retrieve,
    });

    await expect(handler(event({ question: '   ' }))).rejects.toMatchObject({ status: 400 });
    expect(retrieve).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a depleted project bucket before model spend', async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    const handler = createProjectChatHandler({
      slug: 'example',
      systemPrompt: 'System',
      retrieve: () => [],
    });

    await expect(handler(event({ question: 'Hello' }))).rejects.toMatchObject({ status: 429 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keys the visitor on the edge address, never on X-Forwarded-For', async () => {
    const handler = createProjectChatHandler({ slug: 'example', systemPrompt: 'x', retrieve: () => [{ title: 't', text: 'p' }] });
    const keyFor = async (headers: Record<string, string>) => {
      mocks.rateLimit.mockClear();
      await handler({
        request: new Request('http://localhost/projects/example/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ question: 'q' }),
        }),
        getClientAddress: () => '127.0.0.1',
      } as RequestEvent);
      return (mocks.rateLimit.mock.calls[0] as unknown[])[0];
    };
    const plain = await keyFor({ 'cf-connecting-ip': '203.0.113.8' });
    const spoofed = await keyFor({ 'cf-connecting-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.1' });
    expect(spoofed).toBe(plain);
  });

  it('refuses once the daily pool is spent', async () => {
    mocks.rateLimit.mockImplementation(((key: string) => ({
      allowed: !key.startsWith('public:daily:'), remaining: 0, retryAfterMs: 1000,
    })) as never);
    const handler = createProjectChatHandler({ slug: 'example', systemPrompt: 'x', retrieve: () => [{ title: 't', text: 'p' }] });
    await expect(handler(event({ question: 'q' }))).rejects.toMatchObject({ status: 429 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
