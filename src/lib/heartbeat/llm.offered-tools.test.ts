import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A heartbeat turn runs only the tools it OFFERED (P2-14).
 *
 * `execute()` used to run any registered tool the model named, so a scheduled
 * re-engagement could send mail or start a build unattended. The regression
 * half matters as much: the home toolset is offered on purpose, and a scheduled
 * "lights off at 11" must still switch the light.
 */

const h = vi.hoisted(() => ({
  /** Tool calls the fake model makes, in order. */
  script: [] as Array<{ name: string; args: Record<string, unknown> }>,
  executed: [] as Array<{ name: string; args: Record<string, unknown>; ctx: Record<string, unknown> }>,
  results: [] as string[],
  offered: [] as string[],
}));

function chain(rows: unknown[]): unknown {
  const p: unknown = new Proxy(() => {}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res(rows) : () => p),
  });
  return p;
}

vi.mock('$lib/db', () => ({
  db: {
    select: () => chain([{ id: 'conv-1', principalId: 'owner', modelProvider: 'openrouter', modelId: 'test/model' }]),
    insert: () => chain([{ id: 'msg-1' }]),
    update: () => chain([]),
  },
}));
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => ({ client: {}, model: 'test/model' }) }));
vi.mock('$lib/jkai/chat/followup-queue', () => ({ notifySubscribers: () => {} }));
vi.mock('$lib/tools/llm-tools', () => {
  const def = (name: string) => ({ type: 'function', function: { name, description: name, parameters: {} } });
  const sets: Record<string, string[]> = {
    followups: ['followup_status'],
    heartbeat: ['list_heartbeat_actions'],
    schedule: ['schedule_reply_at'],
    home: ['ha_call_service', 'ha_query_state'],
  };
  return { getToolsetDefinitions: async (ts: string) => (sets[ts] ?? []).map(def) };
});
vi.mock('$lib/tools/executor', () => ({
  isRegisteredTool: async () => true,
  executeSiteTool: async (name: string, args: Record<string, unknown>, ctx: Record<string, unknown>) => {
    h.executed.push({ name, args, ctx });
    return { success: true, data: `${name} ok` };
  },
}));
vi.mock('$lib/llm/tool-loop', () => ({
  runToolLoop: async (o: {
    tools?: Array<{ function: { name: string } }>;
    execute: (c: { name: string; args: Record<string, unknown> }, round: number) => Promise<string>;
  }) => {
    h.offered = (o.tools ?? []).map((t) => t.function.name);
    const calls = [];
    for (const c of h.script) {
      h.results.push(await o.execute(c, 0));
      calls.push(c);
    }
    return { reply: 'done', usage: { prompt: 1, completion: 1 }, calls };
  },
}));

const { runHeartbeatTurn } = await import('./llm');
const { fireCallback } = await import('$lib/scheduled/executor');

beforeEach(() => {
  h.script = [];
  h.executed = [];
  h.results = [];
  h.offered = [];
});

describe('heartbeat execute() is limited to the offered tools', () => {
  it('still runs a scheduled light action (home stays offered)', async () => {
    h.script = [{ name: 'ha_call_service', args: { domain: 'light', service: 'turn_off', entity_id: 'light.lounge' } }];
    const res = await fireCallback({
      id: 'cb-1', name: 'lights-off', kind: 'orchestrator-turn', conversationId: 'conv-1',
      payload: { message: 'Turn the lounge light off' }, totalCostUsd: '0',
    } as never);

    expect(res.ok).toBe(true);
    expect(h.offered).toContain('ha_call_service');
    expect(h.executed.map((e) => e.name)).toEqual(['ha_call_service']);
    expect(h.executed[0].args).toMatchObject({ service: 'turn_off', entity_id: 'light.lounge' });
    // The executor gets the same closed list, so a nested call cannot widen it.
    expect(h.executed[0].ctx.allowedTools).toEqual(h.offered);
  });

  it('refuses a tool it did not offer, without running it', async () => {
    h.script = [{ name: 'gmail_send', args: { to: 'x@example.test' } }, { name: 'build_create', args: {} }];
    await runHeartbeatTurn({
      conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '', toolsEnabled: true,
    });

    expect(h.executed).toEqual([]);
    expect(h.results.map((r) => JSON.parse(r))).toEqual([
      { success: false, error: 'gmail_send is not available to a heartbeat turn.' },
      { success: false, error: 'build_create is not available to a heartbeat turn.' },
    ]);
  });

  it('runs nothing at all on a tool-less pulse', async () => {
    h.script = [{ name: 'ha_call_service', args: {} }];
    await runHeartbeatTurn({ conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '' });
    expect(h.offered).toEqual([]);
    expect(h.executed).toEqual([]);
  });
});
