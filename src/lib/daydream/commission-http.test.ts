import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ enabled: true, viewer: 'owner', runtime: vi.fn(), prepare: vi.fn(), decide: vi.fn(), list: vi.fn(), load: vi.fn(), flush: vi.fn() }));
vi.mock('$lib/server/viewer', () => ({ viewerOf: async () => ({ kind: h.viewer }) }));
vi.mock('$lib/workflows/runtime-client', () => ({ invokeWorkflowRuntime: h.runtime }));
vi.mock('./commission-service.server', () => ({ commissioningEnabled: () => h.enabled, prepareCommission: h.prepare, decideCommission: h.decide }));
vi.mock('./commission-executor.server', () => ({ flushCommissionOutbox: h.flush }));
vi.mock('./commission-store.server', () => ({
  CommissionError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  listCommissions: h.list, loadCommission: h.load,
}));
import { commissionResponse } from './commission-http.server';
const id = '11111111-1111-4111-8111-111111111111';
const command = { action: 'decide', id, decision: 'cancel', revision: 2, specHash: 'a'.repeat(64), operationKey: '22222222-2222-4222-8222-222222222222' };
function request(body?: unknown, viewingAs = false) {
  const url = new URL('https://example.test/api/daydream/commissions');
  return commissionResponse({ url, locals: { viewingAs } as unknown as App.Locals,
    request: new Request(url, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks(); h.enabled = true; h.viewer = 'owner';
  h.runtime.mockResolvedValue({}); h.flush.mockResolvedValue({ delivered: 0 });
  h.list.mockResolvedValue([]); h.prepare.mockResolvedValue({ id }); h.decide.mockResolvedValue({ id });
});
describe('shared web/native commission handler', () => {
  it('refuses every non-owner and read-only view-as before any domain access', async () => {
    for (const kind of ['member', 'guest', 'anonymous']) {
      h.viewer = kind; expect((await request()).status).toBe(403);
      expect((await request(command)).status).toBe(403);
    }
    h.viewer = 'owner'; expect((await request(command, true)).status).toBe(403);
    expect(h.list).not.toHaveBeenCalled(); expect(h.decide).not.toHaveBeenCalled();
  });
  it('keeps cancellation available while the workflow runtime is unavailable', async () => {
    h.runtime.mockRejectedValue(new Error('Unavailable'));
    expect((await request(command)).status).toBe(200);
    expect(h.runtime).not.toHaveBeenCalled(); expect(h.decide).toHaveBeenCalledWith(id, command);
  });
  it('rejects malformed revisions and command identities before dispatch', async () => {
    expect((await request({ ...command, revision: -1 })).status).toBe(400);
    expect((await request({ ...command, operationKey: 'no' })).status).toBe(400);
    expect((await request({ ...command, principal: 'owner' })).status).toBe(400);
    expect(h.decide).not.toHaveBeenCalled();
  });
  it('the feature flag blocks new commands and does not seed runtime machinery', async () => {
    h.enabled = false;
    expect(await (await request()).json()).toEqual({ enabled: false, commissions: [] });
    expect((await request(command)).status).toBe(503);
    expect(h.runtime).not.toHaveBeenCalled();
  });
});
