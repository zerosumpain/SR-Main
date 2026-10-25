import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minting a share link with or without a password. Only a project whose card
 * says its app checks one (the Spine) may ask for a password, and the password
 * is never echoed back.
 */

const state = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
}));

vi.mock('$lib/projects/registry', () => ({
  getAllowedProjectKeys: async () => new Set(['spine', 'policy-engine']),
}));
vi.mock('$lib/projects/shares', () => ({
  listShares: async () => [],
  listSharesWithVisits: async () => [],
  revokeShare: async () => true,
  createShare: async (input: Record<string, unknown>) => {
    state.created.push(input);
    return { id: 'id1', token: 'tok'.repeat(15) };
  },
}));

const { POST } = await import('./+server');

async function post(body: Record<string, unknown>) {
  const request = new Request('http://127.0.0.1/api/projects/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const locals = { auth: async () => ({ user: { email: 'owner@x.test' } }) };
  const res = (await POST({ request, locals } as never)) as Response;
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.created.length = 0;
});

describe('POST /api/projects/share', () => {
  it('mints a link with no password by default', async () => {
    const res = await post({ key: 'spine' });
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(false);
    expect(state.created[0].password).toBeNull();
  });

  it('mints a Spine link with its trimmed password, and never echoes it', async () => {
    const res = await post({ key: 'spine', password: '  open sesame ' });
    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sesame');
    expect(state.created[0].password).toBe('open sesame');
  });

  it('refuses a password for a project whose app does not ask for one', async () => {
    const res = await post({ key: 'policy-engine', password: 'open sesame' });
    expect(res.status).toBe(400);
    expect(state.created).toHaveLength(0);
  });

  it('refuses a password that is too short, too long, or not a string', async () => {
    for (const password of ['abc', '   ab   ', '', 'x'.repeat(129), 1234]) {
      expect((await post({ key: 'spine', password })).status).toBe(400);
    }
    expect(state.created).toHaveLength(0);
  });
});
