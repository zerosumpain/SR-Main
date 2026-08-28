import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * Two reminders, one name.
 *
 * `scheduled_callbacks.name` is globally unique and the name is invented by the
 * model, so two unrelated reminders that both land on a generic word became ONE:
 * the second `update`d the first's text, time and conversation in place, and
 * nothing told anyone the first had stopped existing. Canvases have never had
 * this problem — `pickUniqueSlug` uniquifies them — so the same request phrased
 * as "every month" was safe and "tomorrow at 5" was not.
 *
 * Both intents are real (move the existing one; add a second one) and only the
 * caller knows which, so a LIVE clash is refused and `replace_existing` states
 * the intent. A spent callback cannot fire again, so reusing its name is
 * unambiguous and still updates in place.
 */

const CONV = 'e002c8f4-e3d0-4797-95e4-a539a815dca8';

const state = vi.hoisted(() => ({
  existing: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db', () => {
  // Two shapes of read: the conversation lookup (returns the WhatsApp
  // conversation) and the callback-name lookup (returns whatever the test
  // planted). Distinguished by whether a projection was passed, which only
  // resolveConversation does.
  const select = (proj?: unknown) => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: () => (proj ? [{ id: CONV, phone: '+440000000000' }] : state.existing),
    };
    return q;
  };
  return {
    db: {
      select: vi.fn(select),
      insert: vi.fn(() => ({
        values: (vals: Record<string, unknown>) => {
          state.inserts.push(vals);
          return { returning: async () => [{ id: 'cb-new', ...vals }] };
        },
      })),
      update: vi.fn(() => ({
        set: (vals: Record<string, unknown>) => {
          state.updates.push(vals);
          return { where: () => ({ returning: async () => [{ id: 'cb-old', name: 'dinner', ...vals }] }) };
        },
      })),
    },
  };
});

const call = (args: Record<string, unknown>) =>
  executeTool('schedule_reply_at', { name: 'dinner', text: 'Eat.', in_seconds: 600, ...args }, {
    emit: () => {},
    conversationId: CONV,
  });

describe('schedule_reply_at — name collisions', () => {
  beforeEach(() => {
    state.existing = [];
    state.inserts = [];
    state.updates = [];
  });

  it('creates normally when the name is free', async () => {
    const res = await call({});
    expect(res.success).toBe(true);
    expect(state.inserts).toHaveLength(1);
  });

  it('refuses to silently replace a still-pending callback', async () => {
    state.existing = [{ status: 'pending', fireAt: new Date('2026-08-29T17:00:00Z') }];
    const res = await call({ text: 'Something else entirely.' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('already scheduled');
    expect(res.error).toContain('DISTINCT name');
    // The first reminder is untouched — that is the whole point.
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('replaces a pending callback when that is stated to be the intent', async () => {
    state.existing = [{ status: 'pending', fireAt: new Date('2026-08-29T17:00:00Z') }];
    const res = await call({ in_seconds: 1200, replace_existing: true });
    expect(res.success).toBe(true);
    expect(state.updates).toHaveLength(1);
  });

  it.each(['fired', 'failed', 'cancelled'])(
    'reuses the name of a spent (%s) callback without ceremony',
    async (status) => {
      state.existing = [{ status, fireAt: new Date('2026-08-01T17:00:00Z') }];
      const res = await call({});
      expect(res.success).toBe(true);
      expect(state.updates).toHaveLength(1);
    },
  );
});
