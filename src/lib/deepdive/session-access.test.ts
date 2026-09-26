import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: () => false }));

const { researchStartDecision, RESEARCH_DAILY_RUNS } = await import('./session-access.server');
const member = { level: 'self', own: 'u_x' } as const;
const owner = { level: 'owner', own: 'owner' } as const;

describe('researchStartDecision', () => {
  it('never caps the owner', () => {
    expect(researchStartDecision(owner, 'investigation', 999)).toEqual({ ok: true });
  });

  it('lets a member run up to brief depth', () => {
    for (const d of ['instant', 'scan', 'brief'] as const) expect(researchStartDecision(member, d, 0).ok, d).toBe(true);
    expect(researchStartDecision(member, 'investigation', 0)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses the act that would go past the daily cap', () => {
    expect(researchStartDecision(member, 'brief', RESEARCH_DAILY_RUNS - 1).ok).toBe(true);
    expect(researchStartDecision(member, 'brief', RESEARCH_DAILY_RUNS)).toMatchObject({ ok: false, status: 429 });
  });
});
