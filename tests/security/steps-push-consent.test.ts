import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPayload, type PushMessage } from '$lib/server/apns';

const state = vi.hoisted(() => ({
  roster: vi.fn(), role: vi.fn(), select: vi.fn(),
}));
vi.mock('$lib/family/roster.server', () => ({ familyRoster: state.roster, familyRole: state.role }));
vi.mock('$lib/db', () => ({ db: { select: state.select } }));
const { pushToEmails } = await import('$lib/server/push-devices');

const message: PushMessage = {
  title: 'Family steps', body: 'Leader has 6000 steps', category: 'family-steps',
  stepsConsentEmails: ['reader@example.invalid', 'leader@example.invalid'], ttlSeconds: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.role.mockResolvedValue({ parent: false });
  state.roster.mockResolvedValue([
    { email: 'reader@example.invalid', stepsSharing: true },
    { email: 'leader@example.invalid', stepsSharing: true },
  ]);
  state.select.mockReturnValue({ from: () => ({ where: async () => [{
    id: 'device', ownerEmail: 'reader@example.invalid', apnsToken: 'a'.repeat(64), apnsEnv: 'sandbox',
  }] }) });
});
describe('steps push consent at delivery', () => {
  it('sends only when recipient and disclosed person still consent', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect((await pushToEmails(['reader@example.invalid'], message, send)).sent).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(buildPayload(message)).not.toContain('example.invalid');
    expect(buildPayload(message)).not.toContain('stepsConsentEmails');
  });
  it('suppresses a prepared message when the disclosed person opts out', async () => {
    state.roster.mockResolvedValue([{ email: 'reader@example.invalid', stepsSharing: true }]);
    const send = vi.fn();
    expect((await pushToEmails(['reader@example.invalid'], message, send)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
  });
  it('suppresses when the recipient opts out', async () => {
    state.roster.mockResolvedValue([{ email: 'leader@example.invalid', stepsSharing: true }]);
    const send = vi.fn();
    await pushToEmails(['reader@example.invalid'], message, send);
    expect(send).not.toHaveBeenCalled();
  });
  it('fails closed when consent cannot be loaded', async () => {
    state.roster.mockRejectedValue(new Error('Synthetic offline consent service'));
    const send = vi.fn();
    expect((await pushToEmails(['reader@example.invalid'], message, send)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a steps message without its disclosure list', async () => {
    const send = vi.fn();
    await pushToEmails(['reader@example.invalid'], { ...message, stepsConsentEmails: undefined }, send);
    expect(send).not.toHaveBeenCalled();
  });
});
