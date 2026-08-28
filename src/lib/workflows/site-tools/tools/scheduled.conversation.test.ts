import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * Where a scheduled callback is delivered, and who decides.
 *
 * `conversation_id` was a REQUIRED argument. Nothing tells a chat its own id,
 * so over WhatsApp on 2026-08-28 "Remind me in 3 minutes" was answered by
 * inventing one — `07767f2e-…`, a row that has never existed. The tool returned
 * success, the assistant said "Done.", and at fire time the insert died on the
 * `orchestrator_chats.conversation_id` foreign key. A failed callback tells
 * nobody, so the reminder just never came.
 *
 * Two things are pinned here: the id comes from the runtime, and a bad one is
 * refused NOW rather than discovered later with nobody listening.
 */

const WA_CONV = 'e002c8f4-e3d0-4797-95e4-a539a815dca8';
const GHOST = '07767f2e-90bd-4a51-9ae7-ec82f1c849e6';

const captured = vi.hoisted(() => ({ upserts: [] as Array<Record<string, unknown>> }));

vi.mock('$lib/db', () => {
  const mentions = (node: unknown, needle: string, seen = new Set<unknown>()): boolean => {
    if (typeof node === 'string') return node === needle;
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    return Object.values(node as Record<string, unknown>).some((v) => mentions(v, needle, seen));
  };
  // Only WA_CONV exists, and it is a WhatsApp conversation (has a phone).
  const select = () => {
    const q: any = {
      from: () => q,
      where: (cond: unknown) => {
        q._hit = mentions(cond, WA_CONV);
        return q;
      },
      limit: () => (q._hit ? [{ id: WA_CONV, phone: '+440000000000' }] : []),
    };
    // `upsertCallback` reads existing rows with .where().limit() too; an empty
    // result there means "insert", which is the path under test.
    return q;
  };
  return {
    db: {
      select: vi.fn(select),
      insert: vi.fn(() => ({
        values: (vals: Record<string, unknown>) => {
          captured.upserts.push(vals);
          return { returning: async () => [{ id: 'cb-1', ...vals }] };
        },
      })),
      update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) })),
    },
  };
});

describe('schedule_reply_at — which conversation', () => {
  beforeEach(() => {
    captured.upserts = [];
  });

  it('defaults to the calling chat instead of making the model supply one', async () => {
    const res = await executeTool(
      'schedule_reply_at',
      { name: 'three-minute-reminder', text: 'Reminder.', in_seconds: 180 },
      { emit: () => {}, conversationId: WA_CONV },
    );
    expect(res.success).toBe(true);
    expect(captured.upserts[0]).toMatchObject({ conversationId: WA_CONV });
  });

  it('pushes to WhatsApp by default on a WhatsApp conversation', async () => {
    // The original callback stored notifyWhatsApp:false, so even had it not
    // hit the FK it would have landed in a table and left the phone silent.
    await executeTool(
      'schedule_reply_at',
      { name: 'r', text: 'Reminder.', in_seconds: 180 },
      { emit: () => {}, conversationId: WA_CONV },
    );
    expect(captured.upserts[0]).toMatchObject({ payload: { text: 'Reminder.', notifyWhatsApp: true } });
  });

  it('still honours an explicit notify_whatsapp:false', async () => {
    await executeTool(
      'schedule_reply_at',
      { name: 'r', text: 'Reminder.', in_seconds: 180, notify_whatsapp: false },
      { emit: () => {}, conversationId: WA_CONV },
    );
    expect(captured.upserts[0]).toMatchObject({ payload: { notifyWhatsApp: false } });
  });

  it('refuses an invented conversation id at schedule time, not at fire time', async () => {
    const res = await executeTool(
      'schedule_reply_at',
      { name: 'r', text: 'Reminder.', in_seconds: 180, conversation_id: GHOST },
      { emit: () => {}, conversationId: WA_CONV },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain(GHOST);
    expect(captured.upserts).toHaveLength(0);
  });

  it('refuses when there is no chat context at all rather than inventing one', async () => {
    const res = await executeTool(
      'schedule_reply_at',
      { name: 'r', text: 'Reminder.', in_seconds: 180 },
      { emit: () => {} },
    );
    expect(res.success).toBe(false);
    expect(captured.upserts).toHaveLength(0);
  });
});
