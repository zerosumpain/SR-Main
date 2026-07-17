import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { APIUserAbortError } from 'openai';

// Mock the provider/key resolution so the gateway's resilience logic is tested
// in isolation (no network, no keys).
const mockPrimaryCreate = vi.fn();
const mockFallbackCreate = vi.fn();
let primaryProvider: 'zai' | 'openrouter' = 'zai';
let fallbackAvailable = true;

vi.mock('$lib/workflows/nodes/llm-helpers', () => ({
  resolveLLMClient: vi.fn(async () => ({
    client: { chat: { completions: { create: mockPrimaryCreate } } },
    model: 'glm-5-turbo',
    provider: primaryProvider,
  })),
}));
vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn(async () => {
    if (!fallbackAvailable) throw new Error('OpenRouter API key not configured');
    return { client: { chat: { completions: { create: mockFallbackCreate } } }, model: 'anthropic/claude-3-5-haiku' };
  }),
}));
vi.mock('$lib/deepdive/keys', () => ({ getFallbackModel: () => 'anthropic/claude-3-5-haiku' }));

import { resilientChatCompletion } from './workflow-gateway';
import * as llmClient from '$lib/jkai/llm-client';
const getLLMClientMock = llmClient.getLLMClient as unknown as MockInstance;

vi.useFakeTimers();

function rate429() {
  return Object.assign(new Error('Rate limit'), { status: 429 });
}
function ok(content: string, model = 'glm-5-turbo') {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model };
}
function okToolCall(name = 'use_node', args = '{}', model = 'glm-5-turbo') {
  return {
    choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: args } }] } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
    model,
  };
}
const body = { messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, max_tokens: 100 };

describe('resilientChatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    primaryProvider = 'zai';
    fallbackAvailable = true;
  });

  it('returns the primary (z.ai) response when it succeeds — no fallback', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(ok('from zai'));
    const r = await resilientChatCompletion('glm-5-turbo', body);
    expect(r.choices[0].message.content).toBe('from zai');
    expect(getLLMClientMock).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter when z.ai rate-limits', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(ok('from openrouter', 'anthropic/claude-3-5-haiku'));
    const p = resilientChatCompletion('glm-5-turbo', body);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.choices[0].message.content).toBe('from openrouter');
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
  });

  it('falls back to OpenRouter on a z.ai timeout-abort (no caller signal)', async () => {
    mockPrimaryCreate.mockRejectedValue(new APIUserAbortError());
    mockFallbackCreate.mockResolvedValueOnce(ok('recovered', 'anthropic/claude-3-5-haiku'));
    const p = resilientChatCompletion('glm-5-turbo', body);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.choices[0].message.content).toBe('recovered');
    expect(mockPrimaryCreate).toHaveBeenCalledOnce(); // abort not retried
  });

  it('does NOT fall back when the caller aborts (signal already aborted)', async () => {
    mockPrimaryCreate.mockRejectedValue(new APIUserAbortError());
    const ac = new AbortController();
    ac.abort();
    const p = resilientChatCompletion('glm-5-turbo', body, { signal: ac.signal });
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('does NOT fall back when the primary IS already OpenRouter', async () => {
    primaryProvider = 'openrouter';
    mockPrimaryCreate.mockRejectedValue(rate429());
    const p = resilientChatCompletion('openai/gpt-4o', body);
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('surfaces the ORIGINAL error when the fallback is unavailable', async () => {
    fallbackAvailable = false;
    mockPrimaryCreate.mockRejectedValue(rate429());
    const p = resilientChatCompletion('glm-5-turbo', body);
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.e.status).toBe(429);
  });

  it('strips response_format on the OpenRouter fallback call', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(ok('{}', 'anthropic/claude-3-5-haiku'));
    const p = resilientChatCompletion('glm-5-turbo', { ...body, response_format: { type: 'json_object' } });
    await vi.runAllTimersAsync();
    await p;
    const [fbArgs] = mockFallbackCreate.mock.calls[0];
    expect(fbArgs).not.toHaveProperty('response_format');
  });

  // --- Tool-calling passthrough (B7: the orchestrator generation loop needs
  //     tools/tool_choice forwarded, and tool_calls to survive on the result) ---
  it('forwards tools + tool_choice to the provider and surfaces tool_calls', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(okToolCall('use_node', '{"nodeType":"trigger"}'));
    const tools = [{ type: 'function', function: { name: 'use_node', parameters: { type: 'object' } } }];
    const r = await resilientChatCompletion('glm-5-turbo', { ...body, tools, tool_choice: 'auto' });
    const [sentBody] = mockPrimaryCreate.mock.calls[0];
    expect(sentBody.tools).toEqual(tools);
    expect(sentBody.tool_choice).toBe('auto');
    const tc = r.choices[0].message.tool_calls?.[0] as { function?: { name: string } } | undefined;
    expect(tc?.function?.name).toBe('use_node');
  });

  it('keeps tools on the OpenRouter fallback (strips only response_format)', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(okToolCall('finalize_workflow', '{}', 'anthropic/claude-3-5-haiku'));
    const tools = [{ type: 'function', function: { name: 'finalize_workflow', parameters: { type: 'object' } } }];
    const p = resilientChatCompletion('glm-5-turbo', {
      ...body,
      tools,
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
    });
    await vi.runAllTimersAsync();
    const r = await p;
    const [fbBody] = mockFallbackCreate.mock.calls[0];
    expect(fbBody.tools).toEqual(tools);
    expect(fbBody.tool_choice).toBe('auto');
    expect(fbBody).not.toHaveProperty('response_format');
    const tc = r.choices[0].message.tool_calls?.[0] as { function?: { name: string } } | undefined;
    expect(tc?.function?.name).toBe('finalize_workflow');
  });
});
