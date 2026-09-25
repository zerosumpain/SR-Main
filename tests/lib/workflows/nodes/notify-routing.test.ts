import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';

// A workflow's WhatsApp message to the OWNER now goes through notifyOwner, so
// the routing table, the ledger and the iPhone lane apply to it. The promise
// that made that safe to ship: with the shipped default routes, nothing that
// reached WhatsApp before stops reaching it. These tests run the REAL notifier
// against a fake database and a fake WhatsApp channel.

const db = vi.hoisted(() => ({
  /** Stored notification_routes rows (absent = catalogue default). */
  routes: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db/schema', () => ({
  notificationRoutes: { __t: 'routes', category: 'category' },
  notificationEvents: { __t: 'events', id: 'id', category: 'category', dedupeKey: 'dedupeKey', createdAt: 'createdAt' },
}));
vi.mock('$lib/db', () => {
  const chain = (rows: () => unknown[]) => {
    const p = Promise.resolve().then(rows) as Promise<unknown[]> & Record<string, unknown>;
    p.where = () => chain(rows);
    p.limit = () => chain(rows);
    return p;
  };
  return {
    db: {
      select: () => ({
        from: (t: { __t: string }) => chain(() => (t.__t === 'routes' ? db.routes : [])),
      }),
      insert: (t: { __t: string }) => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            db.events.push(v);
            return [{ id: `ev-${db.events.length}` }];
          },
          onConflictDoUpdate: async () => {},
          then: (r: (x: unknown) => unknown) => r(t),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
  };
});

vi.mock('$lib/config/owner', () => ({ ownerPhone: () => '+447700900123' }));

const direct = vi.hoisted(() => vi.fn(async () => ({ sent: true, messageId: 'direct-1' })));
vi.mock('$lib/workflows/whatsapp/service', () => ({ getWhatsAppService: () => ({ sendMessage: direct }) }));
const emitted = vi.hoisted(() => [] as Array<{ type: string; payload: unknown }>);
vi.mock('$lib/events/platform-bus', () => ({
  emit: (type: string, payload: unknown) => {
    emitted.push({ type, payload });
    return { id: 'x', type, payload };
  },
}));

import { registerNotificationChannel, clearNotificationChannels } from '$lib/server/notify';
import { whatsappExecutor } from '$lib/workflows/nodes/whatsapp';
import { notifyExecutor } from '$lib/workflows/nodes/notify';

const channel = vi.fn(async (_text: string) => true);

function ctx(): ExecutionContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workspaceDir: '/tmp',
    dryRun: false,
    emit: () => {},
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
  } as ExecutionContext;
}

beforeEach(() => {
  db.routes = [];
  db.events = [];
  emitted.length = 0;
  direct.mockClear();
  channel.mockClear();
  clearNotificationChannels();
  registerNotificationChannel('whatsapp', channel);
});

describe('whatsapp node → owner', () => {
  it('an existing owner-bound config still reaches WhatsApp under the default routes', async () => {
    // The shape production nodes carry: a literal owner number and a message.
    const result = await whatsappExecutor.execute(
      { summary: 'All good' },
      { to: '+44 7700 900123', message: 'Report: **{{input.summary}}**', formatMarkdown: true, maxChunks: 3 },
      ctx(),
    );
    expect(channel).toHaveBeenCalledTimes(1);
    // Exactly what the node composed — not re-wrapped in a notification title.
    expect(channel).toHaveBeenCalledWith('Report: *All good*');
    expect(direct).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ sent: true, routedVia: 'notify', category: 'system', whatsapp: 'sent', iphone: 'queued' });
    // Written to the ledger, so the phone sees it too.
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ category: 'system', body: 'Report: *All good*' });
  });

  it('honours the category the node names', async () => {
    db.routes = [{ category: 'news', whatsapp: false, native: true, minIntervalSeconds: 0 }];
    const result = await whatsappExecutor.execute({}, { to: '+447700900123', message: 'Top story', category: 'news' }, ctx());
    expect(channel).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ sent: false, category: 'news', whatsapp: 'off', iphone: 'queued', channels: 'iPhone' });
  });

  it('fails the node when WhatsApp was routed and the send failed', async () => {
    channel.mockResolvedValueOnce(false);
    await expect(whatsappExecutor.execute({}, { to: '+447700900123', message: 'x' }, ctx())).rejects.toThrow(/WhatsApp/);
  });

  it('keeps a non-owner recipient on the direct path', async () => {
    await whatsappExecutor.execute({}, { to: '+15550001111', message: 'hi' }, ctx());
    expect(direct).toHaveBeenCalledWith('+15550001111', 'hi');
    expect(channel).not.toHaveBeenCalled();
    expect(db.events).toHaveLength(0);
  });
});

describe('notify node', () => {
  it('raises under the chosen category and reports the channels it went to', async () => {
    const result = await notifyExecutor.execute(
      { pr: 42 },
      { category: 'build', title: 'Shipped #{{input.pr}}', body: 'Merged and live', url: '/jkai/builds', severity: 'info' },
      ctx(),
    );
    expect(channel).toHaveBeenCalledWith(expect.stringContaining('*Shipped #42*'));
    expect(result.output).toMatchObject({ raised: true, category: 'build', whatsapp: 'sent', iphone: 'queued', channels: 'WhatsApp + iPhone' });
    expect(emitted.map((e) => e.type)).toEqual(['notification.raised']);
  });

  it('reports a suppressed raise instead of failing', async () => {
    const result = await notifyExecutor.execute({}, { category: 'health', title: 't', body: 'b' }, ctx());
    // health is phone-only by default
    expect(result.output).toMatchObject({ raised: true, whatsapp: 'off', iphone: 'queued', channels: 'iPhone' });
  });

  it('refuses a raise with nothing to say', async () => {
    await expect(notifyExecutor.execute({}, { category: 'build', title: '', body: '' }, ctx())).rejects.toThrow(/title/);
  });

  // 2026-09-25: "send a rude joke to my whatsapp every hour" was built with
  // category `chat`, which routes to the iPhone only — the 11:35 joke never
  // reached WhatsApp. A channel the owner NAMED must not hinge on a category.
  it('an explicit "Send to: WhatsApp" reaches WhatsApp even under an iPhone-only category', async () => {
    db.routes = [{ category: 'chat', whatsapp: false, native: true, minIntervalSeconds: 0 }];
    const result = await notifyExecutor.execute(
      { response: 'A rude joke' },
      { category: 'chat', channel: 'whatsapp', title: 'Hourly rude joke', body: '{{input.response}}' },
      ctx(),
    );
    expect(channel).toHaveBeenCalledTimes(1);
    expect(result.output).toMatchObject({ whatsapp: 'sent', iphone: 'off' });
  });

  it('"Send to: iPhone" keeps it off WhatsApp even under a WhatsApp category', async () => {
    const result = await notifyExecutor.execute({}, { category: 'system', channel: 'iphone', title: 't' }, ctx());
    expect(channel).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ whatsapp: 'off', iphone: 'queued' });
  });

  it('"both" opens both; "route" (the default) leaves the category in charge', async () => {
    db.routes = [{ category: 'chat', whatsapp: false, native: true, minIntervalSeconds: 0 }];
    const both = await notifyExecutor.execute({}, { category: 'chat', channel: 'both', title: 't' }, ctx());
    expect(both.output).toMatchObject({ whatsapp: 'sent', iphone: 'queued' });
    channel.mockClear();
    const routed = await notifyExecutor.execute({}, { category: 'chat', title: 't2' }, ctx());
    expect(channel).not.toHaveBeenCalled();
    expect(routed.output).toMatchObject({ whatsapp: 'off', iphone: 'queued' });
  });
});

