import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller } from '$lib/family/access.server';
import { familyId, familyPersonFor, familyRoster } from '$lib/family/roster.server';
import { kindOf, listsOf, NOT_FAMILY, parseShare, providerOf, toWire } from '$lib/family/backlog';
import { createItem, describeLink, findByKey, loadItems, prepareLink } from '$lib/family/backlog.server';

/**
 * GET /api/native/family/backlog — the family backlog: `items` still to watch,
 * read or do (newest first) and `finished`, done or dismissed in the last 30
 * days. Everyone in the family sees the same list; `forId` marks who a thing
 * was shared for. People are ids; the phone names them from `people`.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const me = await familyPersonFor(caller.email, caller.parent);
  const roster = await familyRoster();
  const people = roster.map((p) => ({ id: p.id, name: p.name }));
  if (!roster.some((p) => p.email === me.email)) people.push({ id: me.id, name: me.name });
  const lists = listsOf(await loadItems(), new Date());
  const wire = (i: Parameters<typeof toWire>[0]) => toWire(i, familyId);
  return {
    me: { id: me.id, parent: caller.parent },
    people,
    items: lists.items.map(wire),
    finished: lists.finished.map(wire),
  };
});

/**
 * POST /api/native/family/backlog — from the share sheet: `{ url?, text?,
 * note?, forId? }`. A link is cleaned (tracking off, TikTok short links
 * followed) and described (title, site, picture) before it is stored; the
 * same link shared again answers the existing item with `duplicate: true`
 * (200) instead of adding it twice. Text with no link is an idea. 201 on add.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const share = parseShare(await event.request.json().catch(() => null));
  if (!share.ok) return json({ error: share.error }, { status: share.status });
  const s = share.value;

  let forEmail: string | null = null;
  if (s.forId) {
    forEmail = (await familyRoster()).find((p) => p.id === s.forId)?.email ?? null;
    if (!forEmail) return json({ error: 'That person is not in the family.' }, { status: 400 });
  }

  if (s.kind === 'idea') {
    const item = await createItem({
      kind: 'idea', url: null, canonicalUrl: null, provider: null, title: s.title, siteName: null,
      thumbnailUrl: null, note: s.note, forEmail, addedByEmail: caller.email,
    });
    return json({ item: toWire(item, familyId), duplicate: false }, { status: 201 });
  }

  const link = await prepareLink(s.url);
  const existing = await findByKey(link.key);
  if (existing) return json({ item: toWire(existing, familyId), duplicate: true });

  const meta = await describeLink(link.url);
  const item = await createItem({
    kind: kindOf(link.target),
    url: link.url,
    canonicalUrl: link.key,
    provider: providerOf(link.target),
    title: meta.title ?? s.hint,
    siteName: meta.siteName,
    thumbnailUrl: meta.thumbnailUrl,
    note: s.note,
    forEmail,
    addedByEmail: caller.email,
  });
  return json({ item: toWire(item, familyId), duplicate: false }, { status: 201 });
});
