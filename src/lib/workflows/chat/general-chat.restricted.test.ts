import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A member's jkai turn, end to end through the real loop, with the model and
 * the database faked.
 *
 * The model is scripted to try everything a member must not reach — open the
 * gmail and home toolsets, search the owner's memory, send a WhatsApp, delete
 * a tool, spawn an agent — alongside the one thing it may do. What is asserted
 * is what actually happened: which tools the model was OFFERED on every call,
 * which calls reached the EXECUTOR and with what scope, which of the owner's
 * context fetchers ran, and what the system prompt said.
 *
 * The tool catalogue is the real one (loaded through the real executor, which
 * is spied on, not replaced), so owner parity below is measured against the
 * tools the owner actually gets.
 */

const state = vi.hoisted(() => {
  // `./registry` reaches `$lib/workflows`, whose module body boots WhatsApp and
  // Home Assistant unless this is set — reference_test_imports_boot_platform_services.
  process.env.JKAI_BUILDER_PROCESS = '1';
  return {
    thread: null as { principalId: string } | null,
    from: [] as unknown[],
    creates: [] as Array<Record<string, any>>,
    script: [] as Array<{ toolCalls?: Array<{ name: string; args: unknown }>; text?: string }>,
    round: 0,
  };
});

// ── the database ─────────────────────────────────────────────────────────────
vi.mock('$lib/db', async () => {
  const schema = await import('$lib/db/schema');
  // Every builder method returns the chain; awaiting it yields the rows.
  const chain = (rows: () => unknown[]): any => {
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (res: any, rej: any) => Promise.resolve(rows()).then(res, rej);
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const from = (table: unknown) => {
    state.from.push(table);
    return chain(() => (table === schema.conversations ? (state.thread ? [state.thread] : []) : []));
  };
  const db: any = {
    select: () => ({ from }),
    selectDistinct: () => ({ from }),
    insert: () => chain(() => []),
    update: () => chain(() => []),
    delete: () => chain(() => []),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    query: new Proxy({}, { get: () => ({ findFirst: async () => undefined, findMany: async () => [] }) }),
  };
  return { db };
});

// ── the model ────────────────────────────────────────────────────────────────
const getLLMClient = vi.hoisted(() => vi.fn());
vi.mock('$lib/llm/client', () => ({ getLLMClient }));

function scriptedClient() {
  return {
    client: {
      chat: {
        completions: {
          create: async (params: Record<string, any>) => {
            state.creates.push(params);
            if (!params.stream) return { choices: [{ message: { content: 'ok' } }], usage: undefined };
            const step = state.script[state.round++] ?? { text: 'done' };
            const chunks: any[] = [];
            if (step.toolCalls) {
              chunks.push({
                choices: [{
                  delta: {
                    tool_calls: step.toolCalls.map((c, i) => ({
                      index: i,
                      id: `call_${state.round}_${i}`,
                      function: { name: c.name, arguments: JSON.stringify(c.args) },
                    })),
                  },
                  finish_reason: 'tool_calls',
                }],
              });
            } else {
              chunks.push({ choices: [{ delta: { content: step.text ?? 'done' }, finish_reason: 'stop' }] });
            }
            return (async function* () { yield* chunks; })();
          },
        },
      },
    },
    model: 'test-model',
  };
}

// ── tripwires: the owner's context, which a restricted turn must never fetch ─
const tripwires = vi.hoisted(() => ({
  retrieveMemories: vi.fn(async () => []),
  discoverIntegrations: vi.fn(async () => []),
  loadClusterRoster: vi.fn(async () => []),
  buildKnowledgeContext: vi.fn(async () => ''),
  buildEntityGrounding: vi.fn(async () => ''),
  routeTurn: vi.fn(async (message: string) => ({
    route: { kind: 'task', domains: [], entities: [], clusters: [], query: message, capabilities: [], source: 'fallback' },
    ms: 0,
  })),
  resolveThinkingModel: vi.fn(async () => null),
  buildHASystemPromptSection: vi.fn(() => 'HA ENTITY CONTEXT'),
  getCompiledPrompt: vi.fn(),
}));
vi.mock('$lib/jkai/memory/retrieve.server', () => ({ retrieveMemories: tripwires.retrieveMemories }));
vi.mock('$lib/apis/integration-discovery', () => ({ discoverIntegrations: tripwires.discoverIntegrations }));
vi.mock('$lib/jkai/intel/context', () => ({
  loadClusterRoster: tripwires.loadClusterRoster,
  buildKnowledgeContext: tripwires.buildKnowledgeContext,
  buildEntityGrounding: tripwires.buildEntityGrounding,
}));
vi.mock('$lib/jkai/grounding/context-route.server', () => ({
  routeTurn: tripwires.routeTurn,
  resolveAnchors: vi.fn(async () => []),
  clustersForTurn: vi.fn(() => []),
}));
vi.mock('$lib/server/models/settings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveThinkingModel: tripwires.resolveThinkingModel,
}));
vi.mock('$lib/workflows/homeassistant/llm-tools', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildHASystemPromptSection: tripwires.buildHASystemPromptSection,
}));
vi.mock('$lib/workflows/prompts/loader', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/workflows/prompts/loader')>();
  tripwires.getCompiledPrompt.mockImplementation(real.getCompiledPrompt);
  return { ...real, getCompiledPrompt: tripwires.getCompiledPrompt };
});

// ── plumbing that would otherwise reach the datastore or the ledger ─────────
vi.mock('$lib/toolpolicy/policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/toolpolicy/policy')>();
  return { ...real, getActivePolicy: async () => real.emptyPolicy() };
});
vi.mock('$lib/server/models/usage', () => ({
  recordConversationUsage: vi.fn(async () => {}),
  parseUsage: vi.fn(() => ({})),
}));
vi.mock('$lib/jkai/grounding/quality.server', () => ({ recordAnswerQuality: vi.fn(async () => {}) }));

// ── the executor: real, watched ──────────────────────────────────────────────
const executeSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/workflows/site-tools/executor', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/workflows/site-tools/executor')>();
  executeSpy.mockImplementation(real.executeSiteTool);
  return { ...real, executeSiteTool: executeSpy };
});

import { env } from '$env/dynamic/private';
import { generalChat } from './general-chat';
import { MEMBER_CHAT_TOOLS, memberRestriction } from '$lib/jkai/member-chat/policy';
import { ownerPhone } from '$lib/config/owner';
import { homeAssistantConfig } from '$lib/db/schema';

const mutableEnv = env as Record<string, string | undefined>;
const originalPhone = env.WORKFLOW_NOTIFY_PHONE;
// A fake number, so the check below means something without the real one
// appearing anywhere in the repo.
const FAKE_PHONE = '+15550100999';

const ROOT = resolve(__dirname, '../../../..');
/** Every substantial line of an owner prompt file — none may reach a member. */
function ownerPromptLines(file: string): string[] {
  return readFileSync(resolve(ROOT, 'data/prompts', file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 30);
}

const TABLE = { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] };
const ATTACK = [
  { name: 'activate_toolset', args: { toolset: 'gmail' } },
  { name: 'activate_toolset', args: { toolset: 'home' } },
  { name: 'memory_search', args: { query: 'john' } },
  { name: 'whatsapp_send', args: { to: '+440000000000', message: 'hi' } },
  { name: 'delete_tool', args: { name: 'render_table' } },
  { name: 'agent_spawn', args: { task: 'read the inbox' } },
  { name: 'render_table', args: TABLE },
];

const MODEL = { provider: 'openrouter', modelId: 'test/model' } as never;
const CONV = 'conv-restricted-test';

function run(restricted: boolean, text = 'Show me a table and read my email') {
  return generalChat({ text }, [], {
    conversationId: CONV,
    modelContext: MODEL,
    priceSnapshot: null,
    ...(restricted ? { restriction: memberRestriction('u_member') } : {}),
  });
}

const toolNames = (params: Record<string, any>): string[] =>
  (params.tools ?? []).map((t: { function: { name: string } }) => t.function.name);

beforeEach(() => {
  state.thread = { principalId: 'u_member' };
  state.from = [];
  state.creates = [];
  state.script = [{ toolCalls: ATTACK }, { text: 'Here is your table.' }];
  state.round = 0;
  getLLMClient.mockReset();
  getLLMClient.mockImplementation(async () => scriptedClient());
  executeSpy.mockClear();
  for (const fn of Object.values(tripwires)) fn.mockClear();
  mutableEnv.WORKFLOW_NOTIFY_PHONE = FAKE_PHONE;
});

afterAll(() => {
  if (originalPhone === undefined) delete mutableEnv.WORKFLOW_NOTIFY_PHONE;
  else mutableEnv.WORKFLOW_NOTIFY_PHONE = originalPhone;
});

describe('a restricted (member) turn', () => {
  it('is offered, and runs, only its allow-list', async () => {
    const { response } = await run(true);
    expect(response).toBe('Here is your table.');

    // (a) every call that offered tools offered only the allow-list
    const offered = state.creates.filter((c) => c.tools);
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) {
      for (const name of toolNames(c)) expect(MEMBER_CHAT_TOOLS).toContain(name);
    }
    expect(toolNames(offered[0])).toContain('render_table');

    // (b) the executor saw render_table and nothing else, scoped
    expect(executeSpy.mock.calls.map((c) => c[0])).toEqual(['render_table']);
    const ctx = executeSpy.mock.calls[0][2];
    expect(ctx.principalId).toBe('u_member');
    expect([...ctx.allowedTools].sort()).toEqual([...MEMBER_CHAT_TOOLS].sort());

    // every refused call went back to the model as an error result
    const toolMessages = state.creates[state.creates.length - 1].messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages).toHaveLength(ATTACK.length);
    const refused = toolMessages.filter((m: any) => /not available in this conversation/.test(m.content));
    expect(refused).toHaveLength(ATTACK.length - 1);
  });

  it("never reads the Home Assistant registry or the owner's context", async () => {
    await run(true);
    // (c)
    expect(state.from).not.toContain(homeAssistantConfig);
    expect(tripwires.buildHASystemPromptSection).not.toHaveBeenCalled();
    // (e)
    expect(tripwires.retrieveMemories).not.toHaveBeenCalled();
    expect(tripwires.discoverIntegrations).not.toHaveBeenCalled();
    expect(tripwires.loadClusterRoster).not.toHaveBeenCalled();
    expect(tripwires.routeTurn).not.toHaveBeenCalled();
    expect(tripwires.buildKnowledgeContext).not.toHaveBeenCalled();
    expect(tripwires.resolveThinkingModel).not.toHaveBeenCalled();
    expect(tripwires.getCompiledPrompt).not.toHaveBeenCalled();
  });

  it("runs on the member persona, with none of the owner's prompt or number", async () => {
    await run(true);
    const system: string = state.creates.find((c) => c.stream)!.messages[0].content;
    // (d)
    expect(ownerPhone()).toBe(FAKE_PHONE);
    expect(system).not.toContain(FAKE_PHONE);
    expect(system).not.toContain('John');
    for (const line of [...ownerPromptLines('01-soul.md'), ...ownerPromptLines('04-context.md')]) {
      expect(system).not.toContain(line);
    }
    expect(system).toContain('You are talking with a member of the household');
    expect(system).not.toContain('--- Plan phase ---');
    expect(system).not.toContain('--- Skills ---');
  });

  it('caps calls at three a round and twelve a turn', async () => {
    const four = Array.from({ length: 4 }, () => ({ name: 'render_table', args: TABLE }));
    const three = four.slice(0, 3);
    state.script = [{ toolCalls: four }, { toolCalls: three }, { toolCalls: three }, { toolCalls: three }, { toolCalls: three }, { text: 'ok' }];
    await run(true);
    // 3 + 3 + 3 + 3 = 12, then the fifth batch is refused whole.
    expect(executeSpy).toHaveBeenCalledTimes(12);
    const toolMessages = state.creates[state.creates.length - 1].messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages.filter((m: any) => /At most 3 tool calls at once/.test(m.content))).toHaveLength(1);
    expect(toolMessages.filter((m: any) => /Tool-call limit reached/.test(m.content))).toHaveLength(3);
  });
});

describe('the thread-principal guard', () => {
  it("refuses an owner-grade turn on a member's thread before any model call", async () => {
    // (f)
    await expect(run(false)).rejects.toThrow('owner-grade turn refused on a non-owner thread');
    expect(getLLMClient).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("refuses a member's restricted turn on someone else's thread", async () => {
    state.thread = { principalId: 'u_someone_else' };
    await expect(run(true)).rejects.toThrow(/another principal/);
    state.thread = { principalId: 'owner' };
    await expect(run(true)).rejects.toThrow(/another principal/);
    state.thread = null;
    await expect(run(true)).rejects.toThrow(/not found/);
    expect(getLLMClient).not.toHaveBeenCalled();
  });
});

describe("the owner's turn", () => {
  it('still gets the full tool set, prompt and context', async () => {
    state.thread = { principalId: 'owner' };
    state.script = [{ text: 'Hello.' }];
    await run(false, 'What is the weather in Darlington today?');
    const first = state.creates.find((c) => c.stream)!;
    const names = toolNames(first);
    expect(names).toContain('api_call');
    expect(names).toContain('activate_toolset');
    // The owner prompt is the owner's, number included — which is what makes
    // the member assertions above able to fail.
    expect(first.messages[0].content).toContain(FAKE_PHONE);
    expect(tripwires.getCompiledPrompt).toHaveBeenCalled();
    expect(tripwires.routeTurn).toHaveBeenCalled();
    expect(tripwires.retrieveMemories).toHaveBeenCalled();
  });
});
