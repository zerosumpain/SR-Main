import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { APIUserAbortError } from 'openai';

// Mock the provider/key resolution so the gateway's resilience logic is tested
// in isolation (no network, no keys). Post-migration the primary is ALWAYS an
// OpenRouter model; the only fallback gate is getFallbackModel() !== resolved
// primary model (plus the rate-limit / our-timeout classification).
const mockPrimaryCreate = vi.fn();
const mockFallbackCreate = vi.fn();
let primaryModel = 'z-ai/glm-5.2';
let fallbackModel = 'google/gemini-3.1-flash-lite-preview';
let fallbackAvailable = true;

vi.mock('$lib/workflows/nodes/llm-helpers', () => ({
  resolveLLMClient: vi.fn(async () => ({
    client: { chat: { completions: { create: mockPrimaryCreate } } },
    model: primaryModel,
    provider: 'openrouter',
  })),
}));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => {
    if (!fallbackAvailable) throw new Error('OpenRouter API key not configured');
    return { client: { chat: { completions: { create: mockFallbackCreate } } }, model: fallbackModel };
  }),
}));
vi.mock('$lib/llm/keys', () => ({ getFallbackModel: () => fallbackModel }));

import { resilientChatCompletion } from './workflow-gateway';
import * as llmClient from '$lib/llm/client';
const getLLMClientMock = llmClient.getLLMClient as unknown as MockInstance;

vi.useFakeTimers();

function rate429() {
  return Object.assign(new Error('Rate limit'), { status: 429 });
}
function ok(content: string, model = 'z-ai/glm-5.2') {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model };
}
function okToolCall(name = 'use_node', args = '{}', model = 'z-ai/glm-5.2') {
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
    primaryModel = 'z-ai/glm-5.2';
    fallbackModel = 'google/gemini-3.1-flash-lite-preview';
    fallbackAvailable = true;
  });

  it('returns the primary response when it succeeds — no fallback', async () => {
    mockPrimaryCreate.mockResolvedValueOnce(ok('from primary'));
    const r = await resilientChatCompletion('z-ai/glm-5.2', body);
    expect(r.choices[0].message.content).toBe('from primary');
    expect(getLLMClientMock).not.toHaveBeenCalled();
  });

  it('falls back to the fallback model when the primary rate-limits', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(ok('from fallback', fallbackModel));
    const p = resilientChatCompletion('z-ai/glm-5.2', body);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.choices[0].message.content).toBe('from fallback');
    expect(mockFallbackCreate).toHaveBeenCalledOnce();
  });

  it('falls back on a primary timeout-abort (no caller signal), calling the primary once', async () => {
    mockPrimaryCreate.mockRejectedValue(new APIUserAbortError());
    mockFallbackCreate.mockResolvedValueOnce(ok('recovered', fallbackModel));
    const p = resilientChatCompletion('z-ai/glm-5.2', body);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.choices[0].message.content).toBe('recovered');
    expect(mockPrimaryCreate).toHaveBeenCalledOnce(); // abort not retried
  });

  it('does NOT fall back when the caller aborts (signal already aborted)', async () => {
    mockPrimaryCreate.mockRejectedValue(new APIUserAbortError());
    const ac = new AbortController();
    ac.abort();
    const p = resilientChatCompletion('z-ai/glm-5.2', body, { signal: ac.signal });
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('does NOT fall back when the fallback model equals the primary model', async () => {
    fallbackModel = primaryModel; // primary IS the fallback id → retrying hits the same limit
    mockPrimaryCreate.mockRejectedValue(rate429());
    const p = resilientChatCompletion('z-ai/glm-5.2', body);
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    expect(getLLMClientMock).not.toHaveBeenCalled();
    expect(mockFallbackCreate).not.toHaveBeenCalled();
  });

  it('surfaces the ORIGINAL error when the fallback client is unavailable', async () => {
    fallbackAvailable = false;
    mockPrimaryCreate.mockRejectedValue(rate429());
    const p = resilientChatCompletion('z-ai/glm-5.2', body);
    const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await vi.runAllTimersAsync();
    const res = await settled;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.e.status).toBe(429);
  });

  it('strips response_format on the fallback call', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(ok('{}', fallbackModel));
    const p = resilientChatCompletion('z-ai/glm-5.2', { ...body, response_format: { type: 'json_object' } });
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
    const r = await resilientChatCompletion('z-ai/glm-5.2', { ...body, tools, tool_choice: 'auto' });
    const [sentBody] = mockPrimaryCreate.mock.calls[0];
    expect(sentBody.tools).toEqual(tools);
    expect(sentBody.tool_choice).toBe('auto');
    const tc = r.choices[0].message.tool_calls?.[0] as { function?: { name: string } } | undefined;
    expect(tc?.function?.name).toBe('use_node');
  });

  it('keeps tools on the fallback call (strips only response_format)', async () => {
    mockPrimaryCreate.mockRejectedValue(rate429());
    mockFallbackCreate.mockResolvedValueOnce(okToolCall('finalize_workflow', '{}', fallbackModel));
    const tools = [{ type: 'function', function: { name: 'finalize_workflow', parameters: { type: 'object' } } }];
    const p = resilientChatCompletion('z-ai/glm-5.2', {
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
