import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessGroup, activityPrincipals, allowedUser, gmailAccounts } from '$lib/db/schema';
import { deleteGroup, listGroups, loadMember, saveGroup, setUserAccess } from './grants';
import { loadAccessPage } from './access-page';

// Real rows, real resolution. Touches only rows it creates (named with this
// run's tag) and deletes them after; no cleanup, purge or sweep path runs.

const TAG = `g${Math.random().toString(36).slice(2, 10)}`;
const A = `a-${TAG}@example.test`;
const B = `b-${TAG}@example.test`;
const H = `h-${TAG}@example.test`;
const J = `j-${TAG}@example.test`;
const created = { groups: [] as string[] };

describe.skipIf(!process.env.DATABASE_URL)('grants resolve from groups and one-off grants', () => {
  beforeAll(async () => {
    await db.insert(allowedUser).values([
      { email: A, note: 'grants.integration' },
      { email: B, note: 'grants.integration' },
      // A pre-groups household viewer: the role, and no principal (it never needed one).
      { email: H, role: 'household', note: 'grants.integration' },
      { email: J, note: 'grants.integration' },
    ]);
  });

  afterAll(async () => {
    const principals = await db
      .select({ id: activityPrincipals.id })
      .from(activityPrincipals)
      .where(and(eq(activityPrincipals.kind, 'user'), inArray(activityPrincipals.externalRef, [A, B, H, J])));
    const ids = principals.map((p) => p.id);
    if (ids.length) await db.delete(gmailAccounts).where(inArray(gmailAccounts.principalId, ids));
    if (ids.length) await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, ids));
    await db.delete(allowedUser).where(inArray(allowedUser.email, [A, B, H, J]));
    if (created.groups.length) await db.delete(accessGroup).where(inArray(accessGroup.id, created.groups));
  });

  it('seeds the two built-in groups', async () => {
    const groups = await listGroups();
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    expect(byId['family-circle']?.builtIn).toBe(true);
    expect(byId['family-admin']?.builtIn).toBe(true);
  });

  it('a guest with nothing is not a member', async () => {
    expect(await loadMember(A)).toBeNull();
  });

  it('a user put in Family Circle holds family:circle and gets a principal', async () => {
    const saved = await setUserAccess(A, { groups: ['family-circle', 'no-such-group'], grants: ['bogus'] });
    expect(saved).toMatchObject({ groups: ['family-circle'], grants: [] });
    const member = await loadMember(A.toUpperCase());
    expect(member?.principalId).toMatch(/^u_/);
    expect([...(member?.grants ?? [])]).toEqual(['family:circle']);
  });

  it('a group edit changes what its members hold on the next read', async () => {
    const group = await saveGroup({ label: `Readers ${TAG}`, grants: ['research:all', 'nonsense'] });
    if ('error' in group) throw new Error(group.error);
    created.groups.push(group.id);
    expect(group.grants).toEqual(['research:all']);

    await setUserAccess(B, { groups: [group.id], grants: [] });
    expect([...((await loadMember(B))?.grants ?? [])]).toEqual(['research:all']);

    await saveGroup({ id: group.id, label: group.label, grants: ['research:all', 'jkai.intel:self'] });
    expect([...((await loadMember(B))?.grants ?? [])].sort()).toEqual(['jkai.intel:self', 'research:all']);
  });

  it("losing the last intel level stops their Gmail being swept", async () => {
    await setUserAccess(B, { groups: [], grants: ['jkai.intel:self'] });
    const member = await loadMember(B);
    if (!member) throw new Error('expected a member');
    const [account] = await db
      .insert(gmailAccounts)
      .values({
        email: B,
        principalId: member.principalId,
        refreshTokenEnc: 'x',
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        status: 'active',
      })
      .returning({ id: gmailAccounts.id });

    await setUserAccess(B, { groups: [], grants: ['research:self'] });
    const [row] = await db.select({ status: gmailAccounts.status }).from(gmailAccounts).where(eq(gmailAccounts.id, account.id));
    expect(row.status).toBe('disabled');
  });

  it('deleting a group takes it off its members; a built-in cannot be deleted', async () => {
    const group = await saveGroup({ label: `Temp ${TAG}`, grants: ['news:self'] });
    if ('error' in group) throw new Error(group.error);
    created.groups.push(group.id);
    await setUserAccess(A, { groups: ['family-circle', group.id], grants: [] });

    expect(await deleteGroup(group.id)).toBe('deleted');
    const [row] = await db.select({ groups: allowedUser.groups }).from(allowedUser).where(eq(allowedUser.email, A));
    expect(row.groups).toEqual(['family-circle']);
    expect(await deleteGroup('family-circle')).toBe('built-in');
    expect(await deleteGroup(`missing-${TAG}`)).toBe('missing');
  });

  it('a pre-groups household row with no principal keeps the circle, and gets a principal', async () => {
    const member = await loadMember(H);
    expect([...(member?.grants ?? [])]).toEqual(['family:circle']);
    expect(member?.principalId).toMatch(/^u_/);
    expect((await loadMember(H))?.principalId).toBe(member?.principalId);
  });

  it('a hand-mangled jsonb row grants nothing and breaks nothing', async () => {
    await db.execute(sql`update allowed_user set groups = '{"x":1}'::jsonb, grants = '"jkai.intel:admin"'::jsonb where email = ${J}`);
    expect(await loadMember(J)).toBeNull();
    const page = await loadAccessPage();
    expect(page.people.find((p) => p.email === J)).toMatchObject({ groups: [], grants: [], effective: [] });
  });

  it('refuses a second group with the same name', async () => {
    const first = await saveGroup({ label: `Dup ${TAG}`, grants: [] });
    if ('error' in first) throw new Error(first.error);
    created.groups.push(first.id);
    expect(await saveGroup({ label: `dup ${TAG}`, grants: [] })).toEqual({ error: 'A group with that name already exists' });
  });
});
