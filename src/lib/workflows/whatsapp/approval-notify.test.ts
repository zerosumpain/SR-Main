import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APPROVAL_CODE_LENGTH } from './approval-tokens';

// The workflow row planApprovalNotification reads.
let currentRow: Record<string, unknown> | undefined;
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(currentRow === undefined ? [] : [currentRow]),
        }),
      }),
    }),
  },
}));

const sendMessage = vi.fn(
  async (_to: string, _text: string): Promise<{ sent: boolean; error?: string }> => ({ sent: true }),
);
vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({ sendMessage }),
}));

import { planApprovalNotification, sendApprovalPendingMessage } from './approval-notify';

const ROW = (notifications: unknown) => ({
  name: 'canvas:news-pipeline',
  description: 'News Pipeline',
  notifications,
});

beforeEach(() => {
  currentRow = undefined;
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ sent: true });
});

describe('planApprovalNotification — gating', () => {
  it('returns null when the workflow has no notifications config', async () => {
    currentRow = ROW(null);
    expect(await planApprovalNotification('wf1')).toBeNull();
  });

  it('returns null when approvals is not enabled', async () => {
    currentRow = ROW({ onFailure: true });
    expect(await planApprovalNotification('wf1')).toBeNull();
  });

  it('returns null when the channel is not whatsapp', async () => {
    currentRow = ROW({ approvals: true, channel: 'email' });
    expect(await planApprovalNotification('wf1')).toBeNull();
  });

  it('returns a plan when approvals is enabled (channel defaults to whatsapp)', async () => {
    currentRow = ROW({ approvals: true });
    const plan = await planApprovalNotification('wf1');
    expect(plan).not.toBeNull();
    expect(plan!.code).toHaveLength(APPROVAL_CODE_LENGTH);
    expect(plan!.display).toBe('News Pipeline');
    // expiresAt is ~24h out.
    const ms = Date.parse(plan!.expiresAt) - Date.now();
    expect(ms).toBeGreaterThan(23 * 3600_000);
    expect(ms).toBeLessThanOrEqual(24 * 3600_000 + 1000);
  });

  it('returns a plan for an explicit whatsapp channel', async () => {
    currentRow = ROW({ approvals: true, channel: 'whatsapp' });
    expect(await planApprovalNotification('wf1')).not.toBeNull();
  });

  it('never throws — returns null if the db read blows up', async () => {
    // Force the mocked select to reject once by making currentRow a throwing getter.
    currentRow = new Proxy({}, { get() { throw new Error('db boom'); } });
    await expect(planApprovalNotification('wf1')).resolves.toBeNull();
  });
});

describe('sendApprovalPendingMessage', () => {
  const plan = { code: 'ABC234', expiresAt: new Date().toISOString(), display: 'News Pipeline' };

  it('sends a formatted awaiting-approval ping with the code twice', async () => {
    await sendApprovalPendingMessage(plan, 'Publish the morning digest?');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('⏸ News Pipeline awaiting approval:');
    expect(text).toContain('Publish the morning digest?');
    expect(text).toContain('Reply APPROVE ABC234 or DENY ABC234');
  });

  it('collapses whitespace and truncates a very long prompt', async () => {
    const longPrompt = 'word '.repeat(200);
    await sendApprovalPendingMessage(plan, longPrompt);
    const [, text] = sendMessage.mock.calls[0];
    const summary = text.split('awaiting approval: ')[1].split('. Reply APPROVE')[0];
    expect(summary.length).toBeLessThanOrEqual(180);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('never throws when the WhatsApp send rejects', async () => {
    sendMessage.mockRejectedValueOnce(new Error('bridge unreachable'));
    await expect(sendApprovalPendingMessage(plan, 'x')).resolves.toBeUndefined();
  });

  it('never throws on a {sent:false} result', async () => {
    sendMessage.mockResolvedValueOnce({ sent: false, error: 'not connected' });
    await expect(sendApprovalPendingMessage(plan, 'x')).resolves.toBeUndefined();
  });
});
