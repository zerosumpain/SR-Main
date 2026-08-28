import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * "Am I on a canvas?" — the question workflow_build_from_spec refuses on and
 * workflow_generate aims at.
 *
 * It used to be answered by the SHAPE of the chat id: Hermes gave the general
 * hub a synthetic non-UUID chat id and a canvas chat a chat_id equal to the
 * workflow id, so "UUID-shaped => canvas" was true in that topology. Hermes was
 * removed on 2026-08-24, and the in-process loop passes a real
 * `jkai_conversations.id`, which is `gen_random_uuid()::text`. Every chat then
 * looked like a canvas chat: on 2026-08-28 a WhatsApp request for a monthly
 * reminder was refused with "this chat is pinned to a workflow that no longer
 * exists", quoting the conversation's own id back as a workflow id.
 *
 * These tests pin the fix at the boundary that broke — the tool's reading of
 * its context — because the failure was invisible from either end: the tool
 * returned a well-formed, confident refusal, and the model relayed it.
 */

const EXISTING_CANVAS = '11111111-2222-3333-4444-555555555555';

/**
 * Only the canvas lookup matters here: a workflows row exists for
 * EXISTING_CANVAS and for nothing else. Anything the build path would go on to
 * do is unreachable in these cases — every assertion is about the refusal.
 */
vi.mock('$lib/db', () => {
  /** Walk a drizzle condition for a bound string value. It is a cyclic graph
   *  of column/table objects, so JSON.stringify is not an option. */
  const mentions = (node: unknown, needle: string, seen = new Set<unknown>()): boolean => {
    if (typeof node === 'string') return node === needle;
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    return Object.values(node as Record<string, unknown>).some((v) => mentions(v, needle, seen));
  };
  const q: any = {
    from: () => q,
    where: (cond: unknown) => {
      q._hit = mentions(cond, EXISTING_CANVAS);
      return q;
    },
    limit: () => (q._hit ? [{ id: EXISTING_CANVAS }] : []),
  };
  return { db: { select: vi.fn(() => q), insert: vi.fn(() => ({ values: () => ({ returning: () => [] }) })) } };
});

const SPEC = {
  name: 'Claude renewal reminder',
  nodes: [{ id: 'n1', type: 'whatsapp', config: { message: 'Claude renews tomorrow.' } }],
};

describe('workflow_build_from_spec — canvas scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses when the chat is genuinely open on a canvas', async () => {
    const res = await executeTool('workflow_build_from_spec', { ...SPEC }, {
      emit: () => {},
      workflowId: EXISTING_CANVAS,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain(EXISTING_CANVAS);
    expect(res.error).toContain('already on workflow');
  });

  it('does NOT refuse on a UUID conversation id — the WhatsApp/hub regression', async () => {
    // A jkai_conversations.id: UUID-shaped, and no workflows row has it. The
    // old heuristic stopped here; the tool must now get past the guard.
    const res = await executeTool('workflow_build_from_spec', { ...SPEC }, {
      emit: () => {},
      conversationId: 'e002c8f4-e3d0-4797-95e4-a539a815dca8',
    });
    expect(res.error ?? '').not.toContain('already on workflow');
  });

  it('still honours the MCP convention of chat_id = workflow_id', async () => {
    // MCP has no workflowId field; a canvas_chat session sets chat_id to the
    // canvas id, which arrives as conversationId. Confirmed by lookup now,
    // rather than assumed from the shape.
    const res = await executeTool('workflow_build_from_spec', { ...SPEC }, {
      emit: () => {},
      conversationId: EXISTING_CANVAS,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('already on workflow');
  });

  it('does not refuse when there is no chat context at all', async () => {
    const res = await executeTool('workflow_build_from_spec', { ...SPEC }, { emit: () => {} });
    expect(res.error ?? '').not.toContain('already on workflow');
  });
});
