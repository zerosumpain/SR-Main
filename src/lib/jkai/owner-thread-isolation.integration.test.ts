import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';

// No background reader ever reads, delivers into, or learns from a member's
// thread. Seeds one owner thread and one NEWER member thread — the member's is
// the newest thread in the table, so any reader that forgot the owner filter
// picks it — and runs the real readers against the real database.
//
// Touches only rows it creates (tagged), and deletes them after. Every model
// call is a tripwire: nothing here spends.

// Importing the readers reaches $lib/workflows, whose module tail boots
// WhatsApp and Home Assistant for a 'web' process. A builder process boots none.
vi.hoisted(() => {
  process.env.JKAI_SERVICE_ROLE = 'builder';
});

const llmCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/llm/client')>()),
  getLLMClient: vi.fn(async () => {
    llmCalls.n++;
    throw new Error('tripwire: no model call in this test');
  }),
}));
const extractCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/jkai/intel/auto-extract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/jkai/intel/auto-extract')>()),
  extractIntoIntel: vi.fn(async () => {
    extractCalls.n++;
    throw new Error('tripwire: no extraction in this test');
  }),
}));
// The briefing's alert source reaches out to live feeds; it is not what is under test.
vi.mock('$lib/jkai/intel/daily-alerts.server', () => ({ loadDailyAlerts: async () => undefined }));

const TAG = `t${Math.random().toString(36).slice(2, 10)}`;
const OWNER_WORD = `Ownerthread${TAG}`;
const MEMBER_WORD = `Memberthread${TAG}`;
const MEMBER = `u_${TAG}`;
const ids: { owner?: string; member?: string } = {};

describe.skipIf(!process.env.DATABASE_URL)('background readers see only the owner\'s threads', () => {
  beforeAll(async () => {
    const now = Date.now();
    const [owner] = await db
      .insert(conversations)
      .values({ title: `${OWNER_WORD} title`, source: 'web' })
      .returning({ id: conversations.id });
    const [member] = await db
      .insert(conversations)
      .values({ title: `${MEMBER_WORD} title`, source: 'web', principalId: MEMBER })
      .returning({ id: conversations.id });
    ids.owner = owner.id;
    ids.member = member.id;
    // Each: a question 45 min ago and a reply 40 min ago — past the 30-minute
    // idle threshold, so every idle sweep would consider both. The member's
    // rows are a minute newer than the owner's throughout.
    const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);
    await db.insert(orchestratorChats).values([
      { conversationId: owner.id, role: 'user', content: `${OWNER_WORD} what about the boiler`, createdAt: at(45) },
      { conversationId: owner.id, role: 'assistant', content: `${OWNER_WORD} reply`, createdAt: at(40) },
      { conversationId: member.id, role: 'user', content: `${MEMBER_WORD} what about my homework`, createdAt: at(44) },
      { conversationId: member.id, role: 'assistant', content: `${MEMBER_WORD} reply`, createdAt: at(39) },
    ]);
    // Both threads the newest in the table, the member's newest of all.
    await db.update(conversations).set({ updatedAt: new Date(now + 10 * 60_000) }).where(inArray(conversations.id, [owner.id]));
    await db.update(conversations).set({ updatedAt: new Date(now + 20 * 60_000) }).where(inArray(conversations.id, [member.id]));
  });

  afterAll(async () => {
    const all = [ids.owner, ids.member].filter((x): x is string => !!x);
    if (all.length) await db.delete(conversations).where(inArray(conversations.id, all)); // messages cascade
  });

  it('daydream delivers into the owner\'s latest thread, not the newer member thread', async () => {
    const { latestConversationId } = await import('$lib/daydream/deliver');
    expect(await latestConversationId()).toBe(ids.owner);
  });

  it('the Gmail preview lands in the owner\'s latest web thread', async () => {
    const { gmailNotificationTarget } = await import('$lib/workflows/gmail/orchestrator-bridge');
    expect(await gmailNotificationTarget()).toBe(ids.owner);
  });

  it('think/reads chat_threads never names a member thread', async () => {
    const { chatThreadsTool } = await import('$lib/daydream/think/reads');
    const out = await chatThreadsTool({ days: 1 });
    expect(out).toContain(OWNER_WORD);
    expect(out).not.toContain(MEMBER_WORD);
  });

  it('the briefing never gathers a member\'s questions', async () => {
    const { gatherBriefingSignals } = await import('$lib/briefing/gather');
    const out = JSON.stringify(await gatherBriefingSignals());
    expect(out).not.toContain(MEMBER_WORD);
  });

  it('session_search returns no member messages', async () => {
    await import('$lib/workflows/site-tools/tools/recall');
    const { tools } = await import('$lib/workflows/site-tools/registry-internal');
    const tool = tools.find((t) => t.name === 'session_search')!;
    const res = (await tool.handler({ query: TAG, limit: 50 })) as { success: boolean; data: { matches: unknown[] } };
    expect(res.success).toBe(true);
    const out = JSON.stringify(res.data);
    expect(out).toContain(OWNER_WORD);
    expect(out).not.toContain(MEMBER_WORD);
  });

  it('memory review refuses a member thread before any model call', async () => {
    const { reviewConversation } = await import('$lib/workflows/chat/memory-review');
    const before = llmCalls.n;
    await expect(reviewConversation(ids.member!, { strict: true })).rejects.toThrow(/not the owner/i);
    expect(llmCalls.n).toBe(before);
  });

  it('intel extraction skips a member thread, forced or not, and calls nothing', async () => {
    const { maybeExtractThreadConcepts } = await import('$lib/jkai/intel/chat-extract');
    const before = { llm: llmCalls.n, extract: extractCalls.n };
    expect(await maybeExtractThreadConcepts(ids.member!, 'x', { force: true })).toBeUndefined();
    expect(await maybeExtractThreadConcepts(ids.member!, 'x')).toBeUndefined();
    expect(llmCalls.n).toBe(before.llm);
    expect(extractCalls.n).toBe(before.extract);
  });

  it('a heartbeat turn refuses a member thread before any model call or write', async () => {
    const { runHeartbeatTurn, postHeartbeatNote } = await import('$lib/heartbeat/llm');
    const before = llmCalls.n;
    await expect(
      runHeartbeatTurn({ conversationId: ids.member!, userText: 'continue', activityName: 'itest', instruction: '' }),
    ).rejects.toThrow(/not the owner/i);
    await expect(
      postHeartbeatNote({ conversationId: ids.member!, text: 'still working', activityName: 'itest' }),
    ).rejects.toThrow(/not the owner/i);
    expect(llmCalls.n).toBe(before);
    const rows = await db
      .select({ id: orchestratorChats.id })
      .from(orchestratorChats)
      .where(inArray(orchestratorChats.conversationId, [ids.member!]));
    expect(rows).toHaveLength(2); // the two seeded rows, nothing added
  });
});
