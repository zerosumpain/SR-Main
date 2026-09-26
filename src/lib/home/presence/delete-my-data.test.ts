import { describe, expect, it, vi } from 'vitest';

// The module's default dependencies touch the database; these tests inject
// their own, so the real ones only need to import.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./members', () => ({ memberByEmail: async () => null }));

import { DELETE_CONFIRM_WORD, deleteMyUploadedData, type DeleteDeps } from './delete-my-data';

function deps(over: Partial<DeleteDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteDeps = {
    pilotDelete: vi.fn(async (email: string) => {
      calls.push(`pilot:${email}`);
      return { ok: true as const, value: { counts: { health: 3, locations: 40 } } };
    }),
    subjectFor: vi.fn(async (email: string) => {
      calls.push(`subject:${email}`);
      return email === 'sam@example.test' ? 'sam' : null;
    }),
    deleteCompanionTrail: vi.fn(async (subject: string) => {
      calls.push(`trail:${subject}`);
      return 17;
    }),
    ...over,
  };
  return { d, calls };
}

describe('delete my uploaded data', () => {
  it('confirms with the word the form asks for', () => {
    expect(DELETE_CONFIRM_WORD).toBe('delete');
  });

  it('refuses without the typed confirmation, touching nothing', async () => {
    const { d, calls } = deps();
    for (const confirm of [null, '', 'yes', 'delet', 42]) {
      const r = await deleteMyUploadedData('sam@example.test', confirm, d);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(calls).toEqual([]);
  });

  it('refuses a missing email', async () => {
    const { d, calls } = deps();
    expect(await deleteMyUploadedData('  ', 'delete', d)).toMatchObject({ ok: false, status: 401 });
    expect(calls).toEqual([]);
  });

  it('deletes on the pilot FIRST, then this site’s companion trail for their subject', async () => {
    const { d, calls } = deps();
    const r = await deleteMyUploadedData(' Sam@Example.test ', ' Delete ', d);
    expect(r).toEqual({ ok: true, pilot: { health: 3, locations: 40 }, trailRows: 17 });
    expect(calls).toEqual(['pilot:sam@example.test', 'subject:sam@example.test', 'trail:sam']);
  });

  it('with no household row, the pilot is emptied and no trail is touched', async () => {
    const { d, calls } = deps();
    const r = await deleteMyUploadedData('nobody@example.test', 'delete', d);
    expect(r).toEqual({ ok: true, pilot: { health: 3, locations: 40 }, trailRows: 0 });
    expect(calls).toEqual(['pilot:nobody@example.test', 'subject:nobody@example.test']);
  });

  it('stops before the site when the pilot fails — including a 404 — so "deleted" means both', async () => {
    for (const reason of ['unreachable', 'not-found', 'refused', 'unconfigured'] as const) {
      const { d, calls } = deps({ pilotDelete: vi.fn(async () => ({ ok: false as const, reason })) });
      const r = await deleteMyUploadedData('sam@example.test', 'delete', d);
      expect(r).toMatchObject({ ok: false, status: 502 });
      if (!r.ok) expect(r.error).toMatch(/^Nothing was deleted\./);
      expect(calls).toEqual([]);
    }
  });

  it('says so honestly when the pilot is done but the site’s copy is not', async () => {
    const { d } = deps({
      deleteCompanionTrail: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await deleteMyUploadedData('sam@example.test', 'delete', d);
    spy.mockRestore();
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) expect(r.error).toMatch(/app’s copy was deleted/);
  });
});
