import { describe, expect, it, vi } from 'vitest';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '$lib/db/schema';

vi.mock('$lib/db', () => ({ db: {} }));

const { ACCOUNT_COLUMNS, eraseAccount, OWNER_REFUSAL } = await import('./erase');
type Deps = Parameters<typeof eraseAccount>[1] & object;

const MEMBER = 'member@example.test';
const RELAY = 'x1y2@privaterelay.example.test';
const OWNER = 'owner@example.test';

function rows() {
  return {
    conversations: 2, researchRuns: 1, notes: 3, workflows: 0, driveFiles: 1, mailboxes: 0,
    tasksRemoved: 1, tasksAnonymised: 2, stepDays: 5, newsRows: 4,
    attachmentPaths: ['a/1.png'], drivePaths: ['/store/x.pdf'],
  };
}

function deps(over: Partial<Deps> = {}) {
  const calls: string[] = [];
  const d: Deps = {
    isOwner: (e) => e === OWNER,
    resolve: async (e) =>
      e === MEMBER
        ? { addresses: [MEMBER, RELAY], principalId: 'u_abc', householdSubject: 'h1', name: 'Member' }
        : null,
    pilotDeleteUser: async (e) => {
      calls.push(`pilot:${e}`);
      return e === MEMBER ? { ok: true, value: { counts: { health: 3, users: 1 } } } : { ok: false, reason: 'not-found', status: 404 };
    },
    pilotDeleteData: async (e) => {
      calls.push(`pilotData:${e}`);
      return { ok: false, reason: 'not-found', status: 404 };
    },
    eraseRows: async () => {
      calls.push('rows');
      return rows();
    },
    removePerson: async (e) => {
      calls.push(`remove:${e}`);
      return { sitePhones: 1, appPhones: 0, householdUnlinked: true, appError: null };
    },
    eraseAccountRecords: async (a) => {
      calls.push(`records:${a.join(',')}`);
      return 1;
    },
    deleteFiles: async () => {
      calls.push('files');
      return 0;
    },
    notify: async (name, email) => {
      calls.push(`notify:${name}:${email}`);
    },
    ...over,
  };
  return { d, calls };
}

describe('deleting an account from the app', () => {
  it('asks the companion server first, then erases the data, then removes the person, then tells the owner', async () => {
    const { d, calls } = deps();
    const r = await eraseAccount(' Member@Example.test ', d);
    expect(r).toMatchObject({ ok: true, email: MEMBER, pilot: { health: 3, users: 1 }, warnings: [] });
    expect(calls).toEqual([
      `pilot:${MEMBER}`,
      `pilot:${RELAY}`,
      `pilotData:${RELAY}`,
      'rows',
      `remove:${MEMBER}`,
      `records:${MEMBER},${RELAY}`,
      'files',
      `notify:Member:${MEMBER}`,
    ]);
    if (r.ok) expect(r.rows).not.toHaveProperty('attachmentPaths');
  });

  it('never deletes the owner, by address or by alias', async () => {
    const { d, calls } = deps();
    expect(await eraseAccount(OWNER, d)).toEqual({ ok: false, status: 403, error: OWNER_REFUSAL });
    const aliasOfOwner = deps({
      resolve: async () => ({ addresses: [OWNER, MEMBER], principalId: null, householdSubject: null, name: 'Owner' }),
    });
    expect(await eraseAccount(MEMBER, aliasOfOwner.d)).toMatchObject({ ok: false, status: 403 });
    expect([...calls, ...aliasOfOwner.calls]).toEqual([]);
  });

  it('is a 404 for an address with no account and no request, and touches nothing', async () => {
    const { d, calls } = deps();
    expect(await eraseAccount('stranger@example.test', d)).toMatchObject({ ok: false, status: 404 });
    expect(calls).toEqual([]);
  });

  it('stops before this site is touched when the companion server fails', async () => {
    const { d, calls } = deps({ pilotDeleteUser: async () => ({ ok: false, reason: 'unreachable' }) });
    const r = await eraseAccount(MEMBER, d);
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (!r.ok) expect(r.error).toMatch(/^Nothing was deleted/);
    expect(calls).toEqual([]);
  });

  it('falls back to the data wipe on a companion server without the delete route, and says its row survived', async () => {
    const { d, calls } = deps({
      pilotDeleteUser: async () => ({ ok: false, reason: 'not-found', status: 404 }),
      pilotDeleteData: async (e) => (e === MEMBER ? { ok: true, value: { counts: { health: 3 } } } : { ok: false, reason: 'not-found', status: 404 }),
    });
    const r = await eraseAccount(MEMBER, d);
    expect(r).toMatchObject({ ok: true, pilot: { health: 3 } });
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/empty account row/);
    expect(calls).toContain('rows');
  });

  it('carries on without a companion server on a host that has none', async () => {
    const { d } = deps({ pilotDeleteUser: async () => ({ ok: false, reason: 'unconfigured' }) });
    expect(await eraseAccount(MEMBER, d)).toMatchObject({ ok: true, pilot: {} });
  });

  it('leaves the account in place when erasing the data fails, so the phone can retry', async () => {
    const { d, calls } = deps({
      eraseRows: async () => {
        throw new Error('boom');
      },
    });
    expect(await eraseAccount(MEMBER, d)).toMatchObject({ ok: false, status: 500 });
    expect(calls.some((c) => c.startsWith('remove:') || c.startsWith('records:'))).toBe(false);
  });

  it('reports files it could not remove without failing the deletion', async () => {
    const { d } = deps({ deleteFiles: async () => 2 });
    const r = await eraseAccount(MEMBER, d);
    expect(r.ok && r.warnings.join(' ')).toMatch(/2 stored file/);
  });
});

describe('the deletion set', () => {
  // A column that can hold a person's address, or their principal/space id.
  const PERSONAL =
    /(^|_)email$|^email_|owner_key|^owner$|added_by|uploaded_by|resolved_by|decided_by|created_by|external_ref|principal_id|space_id/;

  it('classifies every column in the schema that can name a person', () => {
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const config = getTableConfig(value);
      for (const column of config.columns) {
        if (!PERSONAL.test(column.name)) continue;
        if (!ACCOUNT_COLUMNS[config.name]?.[column.name]) missing.push(`${config.name}.${column.name}`);
      }
    }
    expect(missing, 'add each to ACCOUNT_COLUMNS in erase.ts — and to eraseRows if it is theirs').toEqual([]);
  });

  it('names no column the schema does not have', () => {
    const real = new Map<string, Set<string>>();
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const config = getTableConfig(value);
      real.set(config.name, new Set(config.columns.map((c) => c.name)));
    }
    const stale = Object.entries(ACCOUNT_COLUMNS).flatMap(([table, cols]) =>
      Object.keys(cols).filter((c) => !real.get(table)?.has(c)).map((c) => `${table}.${c}`),
    );
    expect(stale).toEqual([]);
  });

  it('keeps nothing without a reason', () => {
    for (const cols of Object.values(ACCOUNT_COLUMNS)) {
      for (const fate of Object.values(cols)) {
        expect(['erase', 'scrub', 'cascade'].includes(fate) || /^kept: .{8,}/.test(fate)).toBe(true);
      }
    }
  });
});
