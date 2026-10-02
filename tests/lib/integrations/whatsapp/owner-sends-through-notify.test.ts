import { describe, it, expect, vi, beforeEach } from 'vitest';

// Three senders that told the owner something by calling the WhatsApp service
// directly — so a logged-out session meant the message existed nowhere. They go
// through `notifyOwner` now: ledger row first, then WhatsApp and the phone.

const h = vi.hoisted(() => ({ result: { raised: true, id: 'n1', whatsapp: true, routed: { whatsapp: true, native: true } } as Record<string, unknown> }));

vi.mock('$lib/server/notify', async () => ({
  notifyOwner: vi.fn(async () => h.result),
  deliveryReport: (await import('$lib/server/notify/report')).deliveryReport,
}));
vi.mock('$lib/integrations/whatsapp/service', () => ({
  getWhatsAppService: () => {
    throw new Error('the WhatsApp service must not be called directly');
  },
}));
vi.mock('$lib/db', () => {
  const chain = { set: () => chain, where: async () => undefined };
  return { db: { update: () => chain, insert: () => ({ values: async () => undefined }) } };
});
vi.mock('$lib/route-exports', () => ({
  createRouteExport: vi.fn(async () => ({ fileId: 'f1', name: 'loop.gpx', downloadUrl: 'https://strangeramblings.com/s/abc' })),
}));

import { notifyOwner } from '$lib/server/notify';
import { sendApprovalPendingMessage } from '$lib/integrations/whatsapp/approval-notify';
import { fireCallback } from '$lib/scheduled/executor';
import { executeSiteTool } from '$lib/tools/executor';
import type { ScheduledCallback } from '$lib/db/schema';

const notify = vi.mocked(notifyOwner);

beforeEach(() => {
  vi.clearAllMocks();
  h.result = { raised: true, id: 'n1', whatsapp: true, routed: { whatsapp: true, native: true } };
});

describe('approval ping', () => {
  it('goes through the notifier, WhatsApp forced open, keyed on its code', async () => {
    await sendApprovalPendingMessage({ code: 'K7Q2', expiresAt: '2026-09-30T00:00:00Z', display: 'Nightly digest' }, 'Send it?');
    expect(notify).toHaveBeenCalledOnce();
    const input = notify.mock.calls[0][0];
    expect(input).toMatchObject({ category: 'build', dedupeKey: 'approval:K7Q2', channels: { whatsapp: true } });
    expect(input.whatsappText).toBe('⏸ Nightly digest awaiting approval: Send it?. Reply APPROVE K7Q2 or DENY K7Q2');
  });

  it('never throws when the notifier does', async () => {
    notify.mockRejectedValueOnce(new Error('db down'));
    await expect(
      sendApprovalPendingMessage({ code: 'K7Q2', expiresAt: '2026-09-30T00:00:00Z', display: 'x' }, 'y'),
    ).resolves.toBeUndefined();
  });
});

describe('failed scheduled callback', () => {
  it('warns the owner through the notifier, once per callback', async () => {
    // A reply with no payload throws inside fireReply, which is the path that warns.
    const row = { id: 'cb1', name: 'remind me', kind: 'reply', conversationId: 'c1', payload: null, totalCostUsd: '0' } as unknown as ScheduledCallback;
    const result = await fireCallback(row);
    expect(result.ok).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    const input = notify.mock.calls[0][0];
    expect(input).toMatchObject({ category: 'system', severity: 'warn', dedupeKey: 'scheduled:cb1' });
    expect(input.channels).toBeUndefined(); // the owner's routing decides
    expect(input.whatsappText).toMatch(/^⚠ Scheduled callback "remind me" failed/);
  });
});

describe('route_export', () => {
  const args = { gpx: '<gpx/>', basename: 'loop.gpx', activity: 'running', distanceMiles: 5.2 };

  it('sends the link through the notifier with WhatsApp forced open', async () => {
    const res = await executeSiteTool('route_export', args);
    expect(res.success).toBe(true);
    expect(notify.mock.calls[0][0]).toMatchObject({
      category: 'system',
      dedupeKey: 'route-export:f1',
      channels: { whatsapp: true },
      whatsappText: 'Running route ready — 5.2 mi. Download GPX: https://strangeramblings.com/s/abc',
    });
  });

  it('still reports a failed WhatsApp send as a failure', async () => {
    h.result = { raised: true, id: 'n1', whatsapp: false, routed: { whatsapp: true, native: true } };
    const res = await executeSiteTool('route_export', args);
    expect(res.success).toBe(false);
    expect(res.error).toContain('WhatsApp delivery failed');
  });

  it('skips the notifier when sendWhatsapp is false', async () => {
    const res = await executeSiteTool('route_export', { ...args, sendWhatsapp: false });
    expect(res.success).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });
});
