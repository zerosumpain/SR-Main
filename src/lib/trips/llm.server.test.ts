import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, refuseOff: true }));

vi.mock('$lib/models/workloads', () => ({ getWorkload: (id: string) => ({ id, key: `${id}.model`, fallbackModelId: 'openai/gpt-oss-120b' }) }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveWorkloadModel: async () => ({ provider: 'openrouter', modelId: 'openai/gpt-oss-120b' }) }));
vi.mock('$lib/context/activity', () => ({ withActivity: (_tag: string, fn: () => unknown) => fn() }));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({
    model: 'openai/gpt-oss-120b',
    client: {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            h.calls.push(body);
            const off = (body.reasoning as { enabled?: boolean } | undefined)?.enabled === false;
            if (h.refuseOff && off) throw Object.assign(new Error('400 Reasoning is mandatory for this endpoint and cannot be disabled.'), { status: 400 });
            return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] };
          },
        },
      },
    },
  }),
}));

import { clearReasoningMandatoryForTest } from '$lib/models/thinking';
import { jsonCall } from './llm.server';

beforeEach(() => {
  h.calls = [];
  h.refuseOff = true;
  clearReasoningMandatoryForTest();
});

describe('jsonCall and models that must reason', () => {
  it('asks again at low effort with room for the reasoning, and goes straight there next time', async () => {
    expect(await jsonCall('trips-reader', [{ role: 'user', content: 'x' }], { maxTokens: 1000 })).toEqual({ ok: true });
    expect(h.calls.map((c) => [c.reasoning, c.max_tokens])).toEqual([
      [{ enabled: false }, 1000],
      [{ effort: 'low' }, 4000],
    ]);
    h.calls = [];
    await jsonCall('trips-reader', [{ role: 'user', content: 'y' }], { maxTokens: 1000 });
    expect(h.calls.map((c) => [c.reasoning, c.max_tokens])).toEqual([[{ effort: 'low' }, 4000]]);
  });

  it('leaves a model that can stop reasoning alone', async () => {
    h.refuseOff = false;
    await jsonCall('trips-reader', [{ role: 'user', content: 'x' }], { maxTokens: 1000 });
    expect(h.calls.map((c) => c.reasoning)).toEqual([{ enabled: false }]);
  });
});
