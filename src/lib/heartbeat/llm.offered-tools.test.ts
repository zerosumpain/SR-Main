import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A heartbeat turn is a jkai chat turn run by Core (slice 9), offered only the
 * heartbeat's tools (P2-14).
 *
 * `execute()` used to run any registered tool the model named, so a scheduled
 * re-engagement could send mail or start a build unattended. The turn now
 * runs in Core with a closed `toolWhitelist`, which Core carries on the sealed
 * principal and Main's `executeTool` enforces (principal-enforcement.test.ts:
 * an unattended heartbeat runs a listed mutate, nothing else). The regression
 * half matters as much: the home toolset is offered on purpose, and a
 * scheduled "lights off at 11" must still switch the light.
 */

const h = vi.hoisted(() => ({
  calls: [] as Array<{ input: { text: string }; history: unknown[]; options: Record<string, unknown> }>,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  fail: null as Error | null,
}));

function chain(rows: unknown[]): unknown {
  const p: unknown = new Proxy(() => {}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res(rows) : () => p),
  });
  return p;
}

vi.mock('$lib/db', () => ({
  db: {
    select: () => chain([{ id: 'conv-1', principalId: 'owner', modelProvider: 'openrouter', modelId: 'test/model', role: 'user', content: 'earlier', createdAt: new Date('2026-10-28T10:00:00Z') }]),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return chain([{ id: `msg-${h.inserted.length}` }]);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.updated.push(v);
        return chain([]);
      },
    }),
  },
}));
vi.mock('$lib/jkai/chat/followup-queue', () => ({ notifySubscribers: () => {} }));
vi.mock('$lib/server/notify', () => ({ notifyOwner: async () => ({}), deliveryReport: () => ({ raised: true, whatsapp: 'skipped', channels: '' }) }));
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
vi.mock('$lib/jkai/chat/turn', async (orig) => {
  const real = await orig<typeof import('$lib/jkai/chat/turn')>();
  return {
    ...real,
    chatTurn: async (input: { text: string }, history: unknown[], options: Record<string, unknown>) => {
      h.calls.push({ input, history, options });
      if (h.fail) throw h.fail;
      return { response: 'Lounge light is off.', memory: null, identityVersion: 'v9:abc' };
    },
  };
});

const { runHeartbeatTurn, HeartbeatSkipped } = await import('./llm');
const { fireCallback, DEFER_GRACE_MS } = await import('$lib/scheduled/executor');
const { ExtractedAppError } = await import('$lib/server/extracted-app');

beforeEach(() => {
  h.calls = [];
  h.inserted = [];
  h.updated = [];
  h.fail = null;
});

const lightsOff = (fireAt: Date) =>
  ({
    id: 'cb-1', name: 'lights-off', kind: 'orchestrator-turn', conversationId: 'conv-1',
    payload: { message: 'Turn the lounge light off' }, totalCostUsd: '0', fireAt,
  }) as never;

describe('heartbeat turns run as jkai, through Core, on the offered tools only', () => {
  it('still runs a scheduled light action (home stays offered)', async () => {
    const res = await fireCallback(lightsOff(new Date()));

    expect(res.ok).toBe(true);
    expect(h.calls).toHaveLength(1);
    const { options, input } = h.calls[0];
    expect(options.envelope).toEqual({ surface: 'heartbeat' });
    expect(options.activity).toBe('heartbeat');
    expect(options.toolWhitelist).toEqual(['followup_status', 'list_heartbeat_actions', 'schedule_reply_at', 'ha_call_service', 'ha_query_state']);
    expect(options.maxRounds).toBe(4);
    expect(input.text).toContain('Turn the lounge light off');
    expect(input.text).toContain('[Heartbeat instruction]');
    // The rows: the trigger, then jkai's reply, both stamped heartbeat.
    const [user, reply] = h.inserted;
    expect(user).toMatchObject({ role: 'user', content: 'Turn the lounge light off', metadata: { channel: 'heartbeat' } });
    expect(reply).toMatchObject({ role: 'assistant', content: 'Lounge light is off.', metadata: { channel: 'heartbeat', identityVersion: 'v9:abc', heartbeat: { kind: 'reply' } } });
    expect(h.updated[0]).toMatchObject({ status: 'fired' });
  });

  it('never offers mail, builds or anything outside the four toolsets', async () => {
    await runHeartbeatTurn({ conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '', toolsEnabled: true });
    const offered = h.calls[0].options.toolWhitelist as string[];
    expect(offered).not.toContain('gmail_send');
    expect(offered).not.toContain('build_create');
  });

  it('offers nothing at all on a tool-less pulse', async () => {
    await runHeartbeatTurn({ conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '' });
    expect(h.calls[0].options.toolWhitelist).toEqual([]);
    expect(h.calls[0].options.maxRounds).toBe(1);
    expect(h.calls[0].input.text).toBe('go');
  });

  it('skips cleanly when Core is down: nothing written, a typed skip', async () => {
    h.fail = new ExtractedAppError('Error: connect ECONNREFUSED 127.0.0.1:5330');
    await expect(
      runHeartbeatTurn({ conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '' }),
    ).rejects.toBeInstanceOf(HeartbeatSkipped);
    expect(h.inserted).toEqual([]);
  });

  it('leaves a scheduled callback pending while Core is down, and gives up after the grace', async () => {
    h.fail = new ExtractedAppError('jkai-core/api/jkai/service/turn returned 502');
    const fresh = await fireCallback(lightsOff(new Date()));
    expect(fresh).toMatchObject({ ok: false, deferred: true });
    expect(h.updated).toEqual([]);
    expect(h.inserted).toEqual([]);

    const stale = await fireCallback(lightsOff(new Date(Date.now() - DEFER_GRACE_MS - 60_000)));
    expect(stale.ok).toBe(false);
    expect(stale.deferred).toBeUndefined();
    expect(h.updated[0]).toMatchObject({ status: 'failed' });
  });

  it('does not mistake a real failure for Core being down', async () => {
    h.fail = new ExtractedAppError('jkai-core/api/jkai/service/turn returned 400');
    await expect(
      runHeartbeatTurn({ conversationId: 'conv-1', userText: 'go', activityName: 'test', instruction: '' }),
    ).rejects.not.toBeInstanceOf(HeartbeatSkipped);
  });
});
