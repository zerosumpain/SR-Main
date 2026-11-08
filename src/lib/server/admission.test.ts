import { describe, expect, it, vi } from 'vitest';

// The order is the whole point: phones are read BEFORE the write (the trigger
// revokes them during it) and put back AFTER, stamped from the database's own
// clock so only this write's revocations are undone. The database itself is
// covered by access-requests.integration.test.ts.

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('./allow-list', () => ({ addToAllowList: vi.fn() }));
vi.mock('./grants', () => ({ asList: (v: unknown) => (Array.isArray(v) ? v : []), setUserAccess: vi.fn() }));

const { admitToAllowList, keepingPhones } = await import('./admission');

const SINCE = new Date('2026-10-20T09:00:00Z');

function fakes(opts: { phones?: number; listed?: boolean } = {}) {
  const log: string[] = [];
  const phones = Array.from({ length: opts.phones ?? 1 }, (_, i) => ({ id: `p${i}`, apnsToken: null, apnsTokenAt: null, laStartToken: null, laStartTokenAt: null }));
  return {
    log,
    deps: {
      livePhones: async (e: string) => {
        log.push(`read:${e}`);
        return phones;
      },
      databaseNow: async () => {
        log.push('clock');
        return SINCE;
      },
      carryPhones: async (e: string, seen: readonly unknown[], since: Date) => {
        log.push(`carry:${e}:${seen.length}:${since.toISOString()}`);
        return seen.length;
      },
      isListed: async () => opts.listed ?? false,
      add: async (i: { email: string; note?: string | null; addedBy?: string | null }) => {
        log.push(`add:${i.email}:${i.note ?? ''}:${i.addedBy ?? ''}`);
      },
      join: async (e: string, groups: readonly string[]) => {
        log.push(`join:${e}:${groups.join('+')}`);
      },
    },
  };
}

describe('keepingPhones', () => {
  it('reads, stamps the clock, writes, then carries', async () => {
    const f = fakes();
    const r = await keepingPhones('Rory@Example.test', async () => {
      f.log.push('write');
      return 'done';
    }, f.deps);
    expect(r).toEqual({ result: 'done', carried: 1 });
    expect(f.log).toEqual(['read:Rory@Example.test', 'clock', 'write', `carry:Rory@Example.test:1:${SINCE.toISOString()}`]);
  });

  it('carries nothing, and says so, when there was nothing to carry', async () => {
    const f = fakes({ phones: 0 });
    expect(await keepingPhones('x@example.test', async () => 1, f.deps)).toEqual({ result: 1, carried: 0 });
    expect(f.log).not.toContainEqual(expect.stringMatching(/^carry/));
  });
});

describe('admitToAllowList', () => {
  it('adds, joins the groups, and keeps the phones — in that order', async () => {
    const f = fakes({ phones: 2 });
    const r = await admitToAllowList({ email: ' Rory@Example.test ', name: 'Rory', groups: ['family-circle'], addedBy: 'owner@example.test' }, f.deps);
    expect(r).toEqual({ email: 'rory@example.test', created: true, carried: 2 });
    expect(f.log).toEqual([
      'read:rory@example.test',
      'clock',
      'add:rory@example.test:Rory:owner@example.test',
      'join:rory@example.test:family-circle',
      `carry:rory@example.test:2:${SINCE.toISOString()}`,
    ]);
  });

  it('keeps the phones of someone already on the list too — widening what they hold is not a reason to sign them out', async () => {
    const f = fakes({ listed: true });
    const r = await admitToAllowList({ email: 'known@example.test', groups: ['friend'], addedBy: null }, f.deps);
    expect(r).toEqual({ email: 'known@example.test', created: false, carried: 1 });
  });

  it('never admits the owner', async () => {
    const f = fakes();
    await expect(admitToAllowList({ email: 'owner@example.test', addedBy: null }, f.deps)).rejects.toThrow(/configured/);
    expect(f.log).toEqual([]);
  });
});
