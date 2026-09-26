import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessGroup, activityPrincipals, allowedUser } from '$lib/db/schema';

/** Family Circle's grants as THIS database holds them: the seed runs once, so an older database has an older set. */
async function circleGrants(): Promise<string[]> {
  const [row] = await db.select({ grants: accessGroup.grants }).from(accessGroup).where(eq(accessGroup.id, 'family-circle'));
  return [...(row?.grants ?? [])];
}

// The /admin/access API end to end against the real tables. Touches only rows
// it creates (named with this run's tag) and deletes them after.

const TAG = `x${Math.random().toString(36).slice(2, 10)}`;
const EMAIL = `person-${TAG}@example.test`;
const groupIds: string[] = [];

function req(method: string, body: unknown) {
  return {
    request: new Request('http://test.local/api/admin/access', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: { auth: async () => ({ user: { email: 'owner@example.test' } }) },
  } as any;
}

async function send(handler: (e: any) => Promise<Response> | Response, method: string, body: unknown) {
  const res = await handler(req(method, body));
  return { status: res.status, body: (await res.json()) as any };
}

describe.skipIf(!process.env.DATABASE_URL)('/api/admin/access', () => {
  afterAll(async () => {
    const principals = await db
      .select({ id: activityPrincipals.id })
      .from(activityPrincipals)
      .where(and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, EMAIL)));
    if (principals.length) await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, principals.map((p) => p.id)));
    await db.delete(allowedUser).where(eq(allowedUser.email, EMAIL));
    if (groupIds.length) await db.delete(accessGroup).where(inArray(accessGroup.id, groupIds));
  });

  it('adds a person with nothing, then sets their groups and grants', async () => {
    const api = await import('./+server');
    const added = await send(api.POST, 'POST', { email: EMAIL.toUpperCase(), note: 'test' });
    expect(added.status).toBe(200);
    const person = added.body.people.find((p: any) => p.email === EMAIL);
    expect(person).toMatchObject({ groups: [], grants: [], effective: [], legacyRole: null });

    const patched = await send(api.PATCH, 'PATCH', {
      email: EMAIL,
      groups: ['family-circle', 'nope'],
      grants: ['jkai.intel:all', 'jkai.canvas:admin', 'owner'],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.saved).toMatchObject({ groups: ['family-circle'], grants: ['jkai.intel:all'] });
    const after = patched.body.people.find((p: any) => p.email === EMAIL);
    expect([...after.effective].sort()).toEqual([...new Set([...(await circleGrants()), 'jkai.intel:all'])].sort());
  });

  it('refuses a malformed PATCH and an unknown person', async () => {
    const api = await import('./+server');
    expect((await send(api.PATCH, 'PATCH', { email: EMAIL, groups: 'x', grants: [] })).status).toBe(400);
    expect((await send(api.PATCH, 'PATCH', { email: `nobody-${TAG}@example.test`, groups: [], grants: [] })).status).toBe(404);
  });

  it('creates, edits and deletes a group; a built-in refuses deletion', async () => {
    const api = await import('./groups/+server');
    const created = await send(api.POST, 'POST', { label: `Readers ${TAG}`, grants: ['research:all', 'junk'] });
    expect(created.status).toBe(200);
    groupIds.push(created.body.group.id);
    expect(created.body.group.grants).toEqual(['research:all']);

    const edited = await send(api.PATCH, 'PATCH', { id: created.body.group.id, label: `Readers ${TAG}`, grants: ['news:self'] });
    expect(edited.body.group.grants).toEqual(['news:self']);

    expect((await send(api.DELETE, 'DELETE', { id: 'family-circle' })).status).toBe(400);
    expect((await send(api.DELETE, 'DELETE', { id: created.body.group.id })).status).toBe(200);
    expect((await send(api.DELETE, 'DELETE', { id: created.body.group.id })).status).toBe(404);
  });

  it('refuses a nameless group', async () => {
    const api = await import('./groups/+server');
    expect((await send(api.POST, 'POST', { label: '  ', grants: [] })).status).toBe(400);
  });
});
