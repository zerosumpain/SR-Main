// The chat job routes with a member on the other end.
//
// A member posts only in their own thread, attaches only their own files, runs
// on the chat default under a closed tool list, and can see, stream, answer or
// cancel only their own jobs — someone else's is a 404, and survives the
// attempt. The owner's turn is exactly what it was, and he cannot post into a
// member's thread.
//
// The job store and the chat guard are real; the database, the viewer and the
// chat loop are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

// ── stand-ins ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const tables = new Map<unknown, Row[]>();

/** Every bound value in a drizzle condition — enough to match `eq`/`inArray` by id. */
function paramsOf(node: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) paramsOf(n, out, seen);
    return out;
  }
  const o = node as Record<string, unknown>;
  if ('value' in o && 'encoder' in o) {
    if (Array.isArray(o.value)) out.push(...o.value);
    else out.push(o.value);
    return out;
  }
  if ('queryChunks' in o) paramsOf(o.queryChunks, out, seen);
  return out;
}

function selectFrom(table: unknown, where?: unknown): Row[] {
  const rows = tables.get(table) ?? [];
  if (!where) return rows;
  const values = paramsOf(where);
  return rows.filter((r) => Object.values(r).some((v) => values.includes(v)));
}

/** `db.select().from(t).where(c).limit(n)`, awaited, gives `t`'s rows matching `c`. */
function selectChain() {
  let table: unknown;
  let cond: unknown;
  const q: Record<string, unknown> = {
    where: (c: unknown) => ((cond = c), q),
    limit: () => q,
    orderBy: () => q,
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(selectFrom(table, cond)).then(res, rej),
  };
  return { from: (t: unknown) => ((table = t), q) };
}

let nextId = 0;
const inserted: Row[] = [];
vi.mock('$lib/db', () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: (v: Row) => {
        inserted.push(v);
        const ret = { returning: async () => [{ id: `row-${++nextId}` }], onConflictDoNothing: async () => undefined };
        return Object.assign(Promise.resolve(undefined), ret);
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async () => {
      throw new Error('transaction not expected in these tests');
    },
  },
}));

type TestViewer =
  | { kind: 'owner' }
  | { kind: 'anonymous' }
  | { kind: 'member'; principalId: string; email: string; grants: ReadonlySet<string> };
let viewer: TestViewer = { kind: 'owner' };

vi.mock('$lib/server/viewer', async () => {
  const { satisfies } = await vi.importActual<typeof import('$lib/access/catalogue')>('$lib/access/catalogue');
  return {
    viewerOf: async () => viewer,
    isMemberRequest: async () => viewer.kind === 'member',
    viewerHolds: (v: TestViewer, p: string) =>
      v.kind === 'owner' || (v.kind === 'member' && satisfies(v.grants as never, p as never)),
  };
});

vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null }));

const reserveChatTurn = vi.fn(async (_access: unknown) => {});
vi.mock('$lib/jkai/chat-access.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/jkai/chat-access.server')>();
  return { ...actual, reserveChatTurn: (a: unknown) => reserveChatTurn(a) };
});

const generalChat = vi.fn(async (..._args: unknown[]) => ({
  response: 'hello',
  usage: { rounds: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  memory: null,
}));
vi.mock('$lib/workflows/chat/general-chat', () => ({ generalChat: (...a: unknown[]) => generalChat(...a) }));

const DEFAULT_MODEL = { provider: 'openrouter', modelId: 'site/default' };
vi.mock('$lib/server/models/workload-settings', () => ({ resolveChatTurnModel: async () => DEFAULT_MODEL }));
vi.mock('$lib/constants/default-models', () => ({
  coerceModelContext: (x: { provider: string; modelId: string }) => ({ provider: x.provider, modelId: x.modelId }),
}));
vi.mock('$lib/server/models/capabilities', () => ({
  getChatInputCapabilities: () => ({}),
  canAcceptKind: () => true,
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/workflows/chat/conversation-history', () => ({ loadConversationHistory: async () => [] }));
vi.mock('$lib/workflows/chat/ephemeral-sidecar', () => ({ extractEphemeralSidecar: (s: unknown) => s }));
vi.mock('$lib/jkai/tool-step-bus', () => ({
  subscribeToolSteps: vi.fn(),
  registerToolConfirmer: vi.fn(),
  registerSecretRequester: vi.fn(),
}));
vi.mock('$lib/workflows/chat/confirmation-gate', () => ({ requireConfirmation: vi.fn() }));
vi.mock('$lib/workflows/chat/secret-gate', () => ({ requireSecret: vi.fn(), requireSecretUpdate: vi.fn() }));
vi.mock('$lib/workflows/site-tools/tools/request-credential', () => ({ specForRequest: vi.fn() }));
vi.mock('$lib/llm/pricing', () => ({ priceFor: () => null, computeCost: () => 0 }));
vi.mock('$lib/jkai/workflow-refs', () => ({ collectWorkflowRefs: () => [], finishWorkflowRefs: () => [] }));
vi.mock('$lib/llm/usage-log', () => ({ recordDurableLLMCall: vi.fn() }));
const maybeExtractThreadConcepts = vi.fn(async () => {});
vi.mock('$lib/jkai/intel/chat-extract', () => ({ maybeExtractThreadConcepts: () => maybeExtractThreadConcepts() }));
const OWNER_SCOPE = Object.freeze(['owner']);
vi.mock('$lib/jkai/intel/scope', () => ({ isOwnerScope: (s: unknown) => s === OWNER_SCOPE }));
const resolveRequestScope = vi.fn(async () => OWNER_SCOPE as readonly string[]);
vi.mock('$lib/jkai/intel/scope.server', () => ({ resolveRequestScope: () => resolveRequestScope() }));
vi.mock('$lib/mcp/extended-tool', () => ({ JKAI_EXTENDED_TOOL: {} }));
vi.mock('$lib/jkai/tool-trace', () => ({
  createTraceRecorder: () => ({ observe() {}, hasSteps: () => false, snapshot: () => ({}) }),
  compactStepsForMessage: () => [],
}));
vi.mock('$lib/jkai/thread-title', () => ({ isPlaceholderTitle: (t: unknown) => !t, titleFromMessage: (m: string) => m.slice(0, 50) }));
const refileConversationFiles = vi.fn(async () => {});
vi.mock('$lib/jkai/media/drive-link', () => ({ refileConversationFiles: () => refileConversationFiles() }));

// ── subject ──────────────────────────────────────────────────────────────────

import { conversations, jkaiAttachments } from '$lib/db/schema';
import { MEMBER_CHAT_TOOLS } from '$lib/jkai/member-chat/policy';
import {
  createJob,
  createWaiter,
  getJob,
  cancelJob,
  cleanOldJobs,
  publishJobEvent,
} from '$lib/workflows/chat/job-store';
import { POST, GET, DELETE, PATCH } from './+server';
import { GET as STREAM } from './stream/+server';
import { GET as ACTIVE } from './active/+server';
import { POST as PRESENCE } from './presence/+server';

const MEMBER: TestViewer = {
  kind: 'member',
  principalId: 'u_a',
  email: 'a@example.com',
  grants: new Set(['jkai.chat:self']),
};
const OWNER: TestViewer = { kind: 'owner' };

const OWNER_THREAD = 'conv-owner';
const MEMBER_THREAD = 'conv-member';

function conv(id: string, principalId: string): Row {
  return {
    id,
    principalId,
    title: 'A thread',
    modelProvider: 'openrouter',
    modelId: 'pinned/model',
    modelPinnedByUser: true,
    priceSnapshot: { input: 1, output: 2 },
    thinkingLevel: 'high',
  };
}

function event(method: string, path: string, body?: unknown) {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, url, locals: {} } as never;
}

/** Status + body, whether the handler returned a Response or threw a kit error. */
async function call(
  handler: (e: never) => Promise<Response> | Response,
  e: never,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await handler(e);
    const text = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, body: text };
  } catch (err) {
    if (isHttpError(err)) return { status: err.status, body: err.body as unknown as Record<string, unknown> };
    throw err;
  }
}

const post = (body: Record<string, unknown>) =>
  call(POST as never, event('POST', '/api/workflows/orchestrator/chat', body));

beforeEach(() => {
  viewer = OWNER;
  tables.clear();
  tables.set(conversations, [conv(OWNER_THREAD, 'owner'), conv(MEMBER_THREAD, 'u_a')]);
  tables.set(jkaiAttachments, [
    { id: 'att-owner', principalId: 'owner', kind: 'image' },
    { id: 'att-member', principalId: 'u_a', kind: 'image' },
  ]);
  inserted.length = 0;
  generalChat.mockClear();
  reserveChatTurn.mockReset();
  reserveChatTurn.mockImplementation(async () => {});
  refileConversationFiles.mockClear();
  resolveRequestScope.mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  // Let any background turn finish, then drop every job this test made.
  await new Promise((r) => setTimeout(r, 0));
  cleanOldJobs(0);
});

async function settled(jobId: string) {
  await vi.waitFor(() => expect(getJob(jobId)?.status).not.toBe('running'));
}

// ── POST ─────────────────────────────────────────────────────────────────────

describe('POST — a member posts only in their own thread', () => {
  beforeEach(() => {
    viewer = MEMBER;
  });

  it("404s a member posting into the owner's thread", async () => {
    const r = await post({ message: 'hi', conversationId: OWNER_THREAD });
    expect(r.status).toBe(404);
    expect(generalChat).not.toHaveBeenCalled();
  });

  it('400s a member sending a workflowId or chatNodeId, or no conversationId', async () => {
    expect((await post({ message: 'hi', conversationId: MEMBER_THREAD, workflowId: 'wf-1' })).status).toBe(400);
    expect((await post({ message: 'hi', conversationId: MEMBER_THREAD, chatNodeId: 'n-1' })).status).toBe(400);
    expect((await post({ message: 'hi' })).status).toBe(400);
    expect(reserveChatTurn).not.toHaveBeenCalled();
  });

  it("404s a member attaching the owner's file", async () => {
    const r = await post({ message: 'hi', conversationId: MEMBER_THREAD, attachmentIds: ['att-owner'] });
    expect(r.status).toBe(404);
    expect(reserveChatTurn).not.toHaveBeenCalled();
  });

  it('429s the turn past the daily cap, before any job starts', async () => {
    const { error } = await import('@sveltejs/kit');
    reserveChatTurn.mockImplementation(async () => {
      throw error(429, 'That is 50 messages today — the limit. Try again tomorrow.');
    });
    const running = createJob('earlier turn', { conversationId: MEMBER_THREAD, principalId: 'u_a' });
    const r = await post({ message: 'the 51st', conversationId: MEMBER_THREAD });
    expect(r.status).toBe(429);
    expect(generalChat).not.toHaveBeenCalled();
    // A refused turn does not supersede the one already answering.
    expect(getJob(running.jobId)?.status).toBe('running');
    cancelJob(running.jobId);
  });

  it('runs the turn restricted, on the chat default, with no pinned model or thinking level', async () => {
    const r = await post({
      message: 'hi',
      conversationId: MEMBER_THREAD,
      attachmentIds: ['att-member'],
      silent: true,
      intelEntityIds: ['e1'],
    });
    expect(r.status).toBe(200);
    const jobId = r.body!.jobId as string;
    expect(getJob(jobId)?.scope.principalId).toBe('u_a');
    expect(reserveChatTurn).toHaveBeenCalledTimes(1);
    await settled(jobId);

    const opts = generalChat.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.restriction).toEqual({ principalId: 'u_a', allow: [...MEMBER_CHAT_TOOLS] });
    expect(opts.modelContext).toEqual(DEFAULT_MODEL);
    expect(opts.sessionModel).toBeNull();
    expect(opts.thinkingLevel).toBeNull();
    expect(opts.priceSnapshot).toBeNull();
    expect(opts.useIntelContext).toBe(false);
    // No intel level held: no scope resolved (it would 403), no grounding.
    expect(resolveRequestScope).not.toHaveBeenCalled();
    expect((generalChat.mock.calls[0][0] as { text: string }).text).toBe('hi');
    expect(refileConversationFiles).not.toHaveBeenCalled();
    // `silent` is the owner's machinery: a member's turn always posts its bubble.
    expect(inserted).toContainEqual(expect.objectContaining({ conversationId: MEMBER_THREAD, role: 'user', content: 'hi' }));
  });
});

describe('POST — the owner', () => {
  it("403s the owner posting into a member's thread", async () => {
    const r = await post({ message: 'hi', conversationId: MEMBER_THREAD });
    expect(r.status).toBe(403);
    expect(generalChat).not.toHaveBeenCalled();
  });

  it('passes the same options as before, plus an undefined restriction', async () => {
    tables.set(conversations, [{ ...conv(OWNER_THREAD, 'owner'), title: null }]);
    const r = await post({ message: 'hi', conversationId: OWNER_THREAD, attachmentIds: ['att-owner'] });
    expect(r.status).toBe(200);
    const jobId = r.body!.jobId as string;
    expect(getJob(jobId)?.scope.principalId).toBe('owner');
    await settled(jobId);

    const opts = generalChat.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(opts).sort()).toEqual(
      [
        'workflowId',
        'conversationId',
        'jobId',
        'onProgress',
        'onToolProgress',
        'onStreamEvent',
        'modelContext',
        'sessionModel',
        'thinkingLevel',
        'priceSnapshot',
        'useIntelContext',
        'restriction',
      ].sort(),
    );
    expect(opts.restriction).toBeUndefined();
    const pinned = { provider: 'openrouter', modelId: 'pinned/model' };
    expect(opts.modelContext).toEqual(pinned);
    expect(opts.sessionModel).toEqual(pinned);
    expect(opts.thinkingLevel).toBe('high');
    expect(opts.priceSnapshot).toEqual({ input: 1, output: 2 });
    expect(opts.useIntelContext).toBe(true);
    expect(resolveRequestScope).toHaveBeenCalled();
    // Owner turns are never metered; his placeholder-titled thread is refiled.
    expect(reserveChatTurn).not.toHaveBeenCalled();
    expect(refileConversationFiles).toHaveBeenCalledTimes(1);
  });
});

// ── GET / DELETE / PATCH / stream / active / presence ────────────────────────

describe("job routes — a member never reaches the owner's job", () => {
  it('GET with the owner jobId 404s and does not reap the finished job', async () => {
    vi.useFakeTimers();
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    publishJobEvent(owner.jobId, { type: 'done', result: {} });
    getJob(owner.jobId)!.status = 'done';

    viewer = MEMBER;
    const r = await call(GET as never, event('GET', `/api/workflows/orchestrator/chat?jobId=${owner.jobId}`));
    expect(r.status).toBe(404);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(getJob(owner.jobId)).not.toBeNull();
  });

  it('DELETE with the owner jobId 404s and the job keeps running', async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    viewer = MEMBER;
    const r = await call(DELETE as never, event('DELETE', `/api/workflows/orchestrator/chat?jobId=${owner.jobId}`));
    expect(r.status).toBe(404);
    expect(getJob(owner.jobId)?.status).toBe('running');
    cancelJob(owner.jobId);
  });

  it("PATCH with the owner jobId 404s and leaves the owner's waiter open", async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    let answered = false;
    void createWaiter(owner.jobId, 'confirm:c1')
      .awaitResponse()
      .then(() => { answered = true; })
      .catch(() => {});
    viewer = MEMBER;
    const r = await call(
      PATCH as never,
      event('PATCH', `/api/workflows/orchestrator/chat?jobId=${owner.jobId}`, {
        type: 'confirm_ack',
        confirmId: 'c1',
        decision: 'approved',
      }),
    );
    expect(r.status).toBe(404);
    await new Promise((res) => setTimeout(res, 0));
    expect(answered).toBe(false);
    expect(getJob(owner.jobId)?.waiterOpenedAt).not.toBeNull();
    cancelJob(owner.jobId);
  });

  it("stream 404s on the owner's job, before any frame is replayed", async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    publishJobEvent(owner.jobId, { type: 'token', delta: 'secret words' });
    viewer = MEMBER;
    const r = await call(STREAM as never, event('GET', `/api/workflows/orchestrator/chat/stream?jobId=${owner.jobId}`));
    expect(r.status).toBe(404);
    cancelJob(owner.jobId);
  });

  it('a member streams their own job', async () => {
    const mine = createJob('member turn', { conversationId: MEMBER_THREAD, principalId: 'u_a' });
    viewer = MEMBER;
    const res = await (STREAM as never as (e: never) => Promise<Response>)(
      event('GET', `/api/workflows/orchestrator/chat/stream?jobId=${mine.jobId}`),
    );
    expect(res.status).toBe(200);
    await res.body?.cancel();
    cancelJob(mine.jobId);
  });

  it('GET without an id lists only their jobs; the owner still sees all', async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    const mine = createJob('member turn', { conversationId: MEMBER_THREAD, principalId: 'u_a' });
    const theirs = createJob('other member', { conversationId: 'conv-b', principalId: 'u_b' });

    viewer = MEMBER;
    const r = await call(GET as never, event('GET', '/api/workflows/orchestrator/chat'));
    expect((r.body!.jobs as Array<{ id: string }>).map((j) => j.id)).toEqual([mine.jobId]);

    viewer = OWNER;
    const all = await call(GET as never, event('GET', '/api/workflows/orchestrator/chat'));
    expect((all.body!.jobs as Array<{ id: string }>).map((j) => j.id)).toEqual(
      expect.arrayContaining([owner.jobId, mine.jobId, theirs.jobId]),
    );
    for (const j of [owner, mine, theirs]) cancelJob(j.jobId);
  });

  it('DELETE without an id cancels only their jobs', async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    const mine = createJob('member turn', { conversationId: MEMBER_THREAD, principalId: 'u_a' });
    const theirs = createJob('other member', { conversationId: 'conv-b', principalId: 'u_b' });

    viewer = MEMBER;
    const r = await call(DELETE as never, event('DELETE', '/api/workflows/orchestrator/chat'));
    expect(r.status).toBe(200);
    expect(getJob(mine.jobId)?.status).toBe('cancelled');
    expect(getJob(owner.jobId)?.status).toBe('running');
    expect(getJob(theirs.jobId)?.status).toBe('running');
    cancelJob(owner.jobId);
    cancelJob(theirs.jobId);
  });

  it('active shows a member only their running turns', async () => {
    const owner = createJob('owner turn', { conversationId: OWNER_THREAD });
    const mine = createJob('member turn', { conversationId: MEMBER_THREAD, principalId: 'u_a' });

    viewer = MEMBER;
    const one = await call(ACTIVE as never, event('GET', `/api/workflows/orchestrator/chat/active?conversationId=${OWNER_THREAD}`));
    expect(one.body).toEqual({ jobId: null });
    const own = await call(ACTIVE as never, event('GET', `/api/workflows/orchestrator/chat/active?conversationId=${MEMBER_THREAD}`));
    expect(own.body).toEqual({ jobId: mine.jobId });
    const list = await call(ACTIVE as never, event('GET', '/api/workflows/orchestrator/chat/active'));
    expect(list.body!.jobs).toEqual([{ conversationId: MEMBER_THREAD, jobId: mine.jobId }]);

    viewer = OWNER;
    const ownerView = await call(ACTIVE as never, event('GET', `/api/workflows/orchestrator/chat/active?conversationId=${OWNER_THREAD}`));
    expect(ownerView.body).toEqual({ jobId: owner.jobId });
    cancelJob(owner.jobId);
    cancelJob(mine.jobId);
  });

  it("presence is a no-op for a member — it cannot silence the owner's pings", async () => {
    const { isUserPresent } = await import('$lib/workflows/chat/presence');
    viewer = MEMBER;
    const r = await call(PRESENCE as never, event('POST', '/api/workflows/orchestrator/chat/presence', { conversationId: 'conv-presence' }));
    expect(r.status).toBe(204);
    expect(isUserPresent('conv-presence')).toBe(false);

    viewer = OWNER;
    await call(PRESENCE as never, event('POST', '/api/workflows/orchestrator/chat/presence', { conversationId: 'conv-presence' }));
    expect(isUserPresent('conv-presence')).toBe(true);
  });
});
