import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures generalChatMock is available when the hoisted vi.mock factory runs.
const { generalChatMock } = vi.hoisted(() => {
  const generalChatMock = vi.fn();
  return { generalChatMock };
});

vi.mock('$lib/workflows/chat/general-chat', () => ({
  generalChat: generalChatMock,
}));
vi.mock('$lib/workflows/chat/conversation-history', () => ({
  loadConversationHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'glm-4-flash' }),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  },
}));

import { chatExecutor } from '$lib/workflows/nodes/chat';

function makeCtx(overrides: Partial<Parameters<typeof chatExecutor.execute>[2]> = {}) {
  return {
    workflowId: 'w1',
    runId: 'r1',
    emit: vi.fn(),
    getOutgoingEdges: () => [],
    _currentNodeId: 'n-chat',
    ...overrides,
  } as unknown as Parameters<typeof chatExecutor.execute>[2];
}

describe('chat executor — intel override', () => {
  beforeEach(() => {
    generalChatMock.mockReset();
    generalChatMock.mockResolvedValue({ response: 'hello' });
  });

  it('forwards intelContextOverride when input.intelContext is a non-empty string', async () => {
    const input = { message: 'hi', intelContext: 'Focused: projects yesterday' };
    await chatExecutor.execute(input, {}, makeCtx());
    expect(generalChatMock).toHaveBeenCalledTimes(1);
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride).toBe('Focused: projects yesterday');
  });

  it('omits intelContextOverride when input has no intelContext', async () => {
    const input = { message: 'hi' };
    await chatExecutor.execute(input, {}, makeCtx());
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride ?? null).toBeNull();
  });

  it('omits intelContextOverride when input.intelContext is empty string', async () => {
    const input = { message: 'hi', intelContext: '' };
    await chatExecutor.execute(input, {}, makeCtx());
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride ?? null).toBeNull();
  });
});
