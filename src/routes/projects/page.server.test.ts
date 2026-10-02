import { describe, it, expect, vi, beforeEach } from 'vitest';

// The public is sent an empty visibility map, so the hand-built cards MUST be
// filtered on the server. On 2026-10-02 they were filtered in the browser
// against that empty map, every static key fell back to its public default,
// and anonymous visitors saw every card the owner had toggled private.

let visRows: { projectKey: string; isPublic: boolean }[] = [];
let email: string | null = null;

vi.mock('$lib/db', () => {
  // First select() is the builds query (…where().orderBy()), second is the
  // visibility table (…from()). Both are awaited directly.
  let call = 0;
  return {
    db: {
      select: () => {
        const isBuilds = call++ % 2 === 0;
        const chain: any = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          then: (res: (v: unknown) => unknown) => res(isBuilds ? [] : visRows),
        };
        return chain;
      },
    },
  };
});
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e?: string | null) => e === 'owner@example.com' }));

const { load } = await import('./+page.server');
const { PROJECT_CARDS } = await import('./cards');

const run = () => (load as any)({ locals: { auth: async () => (email ? { user: { email } } : null) } });

describe('/projects index load', () => {
  beforeEach(() => {
    email = null;
    visRows = [];
  });

  it('withholds a card toggled private from the public', async () => {
    visRows = [{ projectKey: 'policy-engine', isPublic: false }];
    const data = await run();
    const keys = data.cards.map((c: { key: string }) => c.key);
    expect(keys).not.toContain('policy-engine');
    expect(keys).toContain('engine-room');
    expect(data.visibility).toEqual({});
  });

  it('never shows a private-by-default card to the public', async () => {
    const data = await run();
    expect(data.cards.map((c: { key: string }) => c.key)).not.toContain('field-study-8');
  });

  it('gives the owner every card', async () => {
    email = 'owner@example.com';
    visRows = [{ projectKey: 'policy-engine', isPublic: false }];
    const data = await run();
    expect(data.cards).toHaveLength(PROJECT_CARDS.length);
  });
});
