import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: () => false }));
vi.mock('$lib/db', () => ({ db: {} }));

const { newsCapabilitiesFor } = await import('./capabilities.server');
const member = (...grants: string[]) =>
  ({ kind: 'member', principalId: 'u_x', email: 'x@example.test', grants: new Set(grants) }) as const;

describe('newsCapabilitiesFor', () => {
  it('lets the owner do everything, with his own desk data', () => {
    expect(newsCapabilitiesFor({ kind: 'owner' })).toEqual({ graph: true, research: true, note: true, ask: true, ownerData: true });
  });

  it('gives a news-only member the wire and nothing that writes elsewhere', () => {
    expect(newsCapabilitiesFor(member('news:self') as any)).toEqual({
      graph: false, research: false, note: false, ask: false, ownerData: false,
    });
  });

  it('opens each action with the grant of the area it writes into', () => {
    const can = newsCapabilitiesFor(member('news:self', 'jkai.intel:self', 'research:all') as any);
    expect(can).toMatchObject({ graph: true, research: true, note: false, ownerData: false });
  });
});
