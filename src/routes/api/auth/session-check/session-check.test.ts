import { describe, expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: { VNC_ACCESS_SECRET: 'synthetic-vnc-secret-20260928', AUTH_SECRET: 'different-browser-secret' } }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (email: string | null) => email === 'owner@example.invalid' }));
import { GET } from './+server';
import { issueVncAccessTicket } from '$lib/server/vnc-ticket';

const status = async (email: string | null, ticket?: string) => (await GET({
  locals: { auth: async () => email ? { user: { email } } : null },
  cookies: { get: () => ticket },
} as never)).status;

describe('VNC forward authentication', () => {
  it('requires an owner session or the separately signed narrow ticket', async () => {
    expect(await status(null)).toBe(401);
    expect(await status('friend@example.invalid')).toBe(401);
    expect(await status('registrant@example.invalid')).toBe(401);
    expect(await status('owner@example.invalid')).toBe(204);
    expect(await status(null, issueVncAccessTicket('synthetic-vnc-secret-20260928'))).toBe(204);
    expect(await status(null, issueVncAccessTicket('different-browser-secret'))).toBe(401);
  });
});
