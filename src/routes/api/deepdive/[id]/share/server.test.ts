import { describe, expect, it, vi, beforeEach } from 'vitest';

const issueShare = vi.fn();
const revokeShare = vi.fn(async () => {});
vi.mock('$lib/deepdive/share', () => ({ issueShare, revokeShare }));
vi.mock('$lib/deepdive/session-access.server', () => ({
  requireResearchSession: vi.fn(async () => ({ session: { id: 's1', shareToken: null, shareTokenHash: 'h' } })),
}));

const { POST, DELETE } = await import('./+server');

const ev = (body?: unknown) =>
  ({
    params: { id: 's1' },
    request: new Request('http://test.local/', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  }) as any;

beforeEach(() => {
  issueShare.mockReset();
  revokeShare.mockClear();
});

describe('/api/deepdive/[id]/share', () => {
  it('returns a freshly issued token', async () => {
    issueShare.mockResolvedValue({ status: 'issued', token: 't0k' });
    const res = await POST(ev());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 't0k' });
    expect(issueShare).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), { rotate: false });
  });

  it('answers 409 for a live hashed link instead of a token it does not have', async () => {
    issueShare.mockResolvedValue({ status: 'exists' });
    const res = await POST(ev());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ shared: true });
  });

  it('rotates only on an explicit `rotate: true`', async () => {
    issueShare.mockResolvedValue({ status: 'issued', token: 'new' });
    await POST(ev({ rotate: 'yes' }));
    expect(issueShare).toHaveBeenLastCalledWith(expect.anything(), { rotate: false });
    await POST(ev({ rotate: true }));
    expect(issueShare).toHaveBeenLastCalledWith(expect.anything(), { rotate: true });
  });

  it('revokes', async () => {
    const res = await DELETE(ev());
    expect(res.status).toBe(200);
    expect(revokeShare).toHaveBeenCalledWith('s1');
  });
});
