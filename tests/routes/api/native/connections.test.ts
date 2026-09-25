import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/native/connections — device-gated, served from the watcher's
 * watermark, and asks for a fresh check when that watermark is stale.
 */

let device: { id: string; ownerEmail: string } | null = { id: 'dev-1', ownerEmail: 'owner@example.com' };
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => device,
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));

const item = {
  id: 'gmail:1',
  label: 'Gmail · me@example.com',
  group: 'Email',
  status: 'auth_expired',
  detail: 'Gmail token refresh failed: invalid_grant',
  fixHint: 'Re-authorise me@example.com',
  fixUrl: 'https://strangeramblings.com/api/gmail/connect',
  since: '2026-09-25T07:40:00.000Z',
};
let checkedAt: Date | null = new Date();
vi.mock('$lib/connectors/watch-store', () => ({
  connectorAttention: async () => ({ items: [item], checkedAt }),
}));
const requestConnectorCheck = vi.fn(() => true);
vi.mock('$lib/server/connector-check', () => ({
  requestConnectorCheck: (...a: unknown[]) => requestConnectorCheck(...(a as [])),
}));

async function get() {
  const mod = await import('../../../../src/routes/api/native/connections/+server');
  const request = new Request('http://x/api/native/connections', { headers: { Authorization: 'Bearer t' } });
  return (mod.GET as (e: unknown) => Promise<Response>)({ request, url: new URL(request.url), params: {} });
}

beforeEach(() => {
  device = { id: 'dev-1', ownerEmail: 'owner@example.com' };
  checkedAt = new Date();
  requestConnectorCheck.mockClear();
});

describe('GET /api/native/connections', () => {
  it('401s without a paired device, and 403s a device whose owner left the allow-list', async () => {
    device = null;
    expect((await get()).status).toBe(401);
    device = { id: 'dev-2', ownerEmail: 'someone@else.com' };
    expect((await get()).status).toBe(403);
  });

  it('answers the needs-attention list and when it was checked', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ needsAttention: [item], checkedAt: checkedAt!.toISOString() });
    expect(body.needsAttention[0].fixUrl).toMatch(/^https:\/\/strangeramblings\.com\//);
    expect(requestConnectorCheck).not.toHaveBeenCalled();
  });

  it('asks for a background check when the watermark is older than 45 minutes, or absent', async () => {
    checkedAt = new Date(Date.now() - 46 * 60 * 1000);
    expect((await get()).status).toBe(200);
    expect(requestConnectorCheck).toHaveBeenCalledTimes(1);

    checkedAt = null;
    const body = await (await get()).json();
    expect(body.checkedAt).toBeNull();
    expect(requestConnectorCheck).toHaveBeenCalledTimes(2);
  });
});
