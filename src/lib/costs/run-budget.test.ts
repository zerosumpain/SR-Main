import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gateway is faked: what is under test is the accounting around the call.
const h = vi.hoisted(() => ({
  create: vi.fn(),
  getLLMClient: vi.fn(),
  priceFor: vi.fn(),
}));

vi.mock('$lib/llm/client', () => ({ getLLMClient: h.getLLMClient }));
vi.mock('$lib/llm/pricing', () => ({
  priceFor: h.priceFor,
  computeCost: (p: { in: number; out: number }, tin: number, tout: number) => p.in * tin + p.out * tout,
}));

import { BudgetExceededError, createRunBudget, type RunBudgetCaps } from './run-budget.server';

const CAPS: RunBudgetCaps = { maxLlmCalls: 10, maxCostUsd: 1, maxWallMs: 60_000 };

function budget(caps: Partial<RunBudgetCaps> = {}, extra: { parse?: (t: string) => unknown } = {}) {
  return createRunBudget({
    caps: { ...CAPS, ...caps },
    activity: 'selfimprove',
    resolveModel: async () => ({ provider: 'codex', modelId: 'codex/gpt-x' }),
    temperature: 0.3,
    ...extra,
  });
}

function reply(content: string, usage?: Record<string, unknown>) {
  h.create.mockResolvedValueOnce({ model: 'm-actual', usage, choices: [{ message: { content } }] });
}

beforeEach(() => {
  h.create.mockReset();
  h.priceFor.mockReset();
  h.getLLMClient.mockReset();
  h.getLLMClient.mockResolvedValue({ client: { chat: { completions: { create: h.create } } }, model: 'm' });
});

// Moved here from selfimprove/run.test.ts and workflowdoctor/run.test.ts when
// the two createBudget copies merged — same assertions, one home.
describe('budget caps', () => {
  it('throws BudgetExceededError once the call cap is hit, before any network', async () => {
    const b = budget({ maxLlmCalls: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(b.exceeded).toBe(true);
    expect(b.llmCalls).toBe(0);
    expect(h.getLLMClient).not.toHaveBeenCalled();
  });

  it('throws BudgetExceededError once the cost cap is hit', async () => {
    const b = budget({ maxCostUsd: 0 });
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(b.exceeded).toBe(true);
  });

  it('reports the wall clock left', () => {
    expect(budget({ maxWallMs: 5000 }).timeLeftMs()).toBeGreaterThan(0);
    expect(budget({ maxWallMs: 0 }).timeLeftMs()).toBe(0);
  });

  it('trips on the call after the one that crossed the cost cap', async () => {
    const b = budget({ maxCostUsd: 0.01 });
    reply('{}', { prompt_tokens: 1, completion_tokens: 1, cost: 0.02 });
    await b.call([{ role: 'user', content: 'hi' }]);
    await expect(b.call([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(b.llmCalls).toBe(1);
  });
});

describe('call accounting', () => {
  it("prefers the provider's own usage.cost over the catalogue", async () => {
    h.priceFor.mockReturnValue({ in: 1, out: 1 });
    const b = budget();
    reply('{"a":1}', { prompt_tokens: 100, completion_tokens: 50, cost: 0.0123 });
    const out = await b.call([{ role: 'user', content: 'hi' }]);
    expect(out.json).toEqual({ a: 1 });
    expect(b.costUsd).toBeCloseTo(0.0123);
    expect(b.tokensIn).toBe(100);
    expect(b.tokensOut).toBe(50);
    expect(b.llmCalls).toBe(1);
  });

  it('falls back to the catalogue price for the provider actually resolved', async () => {
    h.priceFor.mockReturnValue({ in: 0.001, out: 0.002 });
    const b = budget();
    reply('x', { prompt_tokens: 10, completion_tokens: 5 });
    await b.call([{ role: 'user', content: 'hi' }]);
    // Not a hard-coded 'openrouter': the resolved model is a Codex one.
    expect(h.priceFor).toHaveBeenCalledWith('codex', 'm-actual');
    expect(b.costUsd).toBeCloseTo(0.02);
  });

  it('counts a call with no usage block, at zero cost', async () => {
    const b = budget();
    reply('x');
    await b.call([{ role: 'user', content: 'hi' }]);
    expect(b.llmCalls).toBe(1);
    expect(b.costUsd).toBe(0);
  });

  it('floors max_tokens at 3000 and defaults the temperature', async () => {
    const b = budget();
    reply('x');
    await b.call([{ role: 'user', content: 'hi' }], { maxTokens: 500 });
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 3000, temperature: 0.3 }));
  });

  it('parses strictly by default and uses the parser it is given', async () => {
    reply('here: {"a":1}');
    expect((await budget().call([{ role: 'user', content: 'hi' }])).json).toBeNull();
    reply('here: {"a":1}');
    const loose = budget({}, { parse: () => 'parsed' });
    expect((await loose.call([{ role: 'user', content: 'hi' }])).json).toBe('parsed');
  });
});

describe('as a SpendGuard', () => {
  it('check() allows with headroom and reports what remains', async () => {
    const b = budget();
    b.record({ tokensIn: 1, tokensOut: 1, costUsd: 0.25 });
    const v = await b.check();
    expect(v.allowed).toBe(true);
    expect(v.reason).toBeNull();
    expect(v.remaining.llmCalls).toBe(9);
    expect(v.remaining.costUsd).toBeCloseTo(0.75);
    expect(v.terminal).toBe(false);
  });

  it('check() refuses terminally once a cap is reached, without flagging exceeded', async () => {
    const b = budget({ maxLlmCalls: 1 });
    b.record({ tokensIn: 0, tokensOut: 0, costUsd: 0 });
    const v = await b.check();
    expect(v.allowed).toBe(false);
    expect(v.terminal).toBe(true);
    expect(v.reason).toMatch(/calls=1\/1/);
    // Only an attempted call marks the run as having hit the cap.
    expect(b.exceeded).toBe(false);
  });
});
