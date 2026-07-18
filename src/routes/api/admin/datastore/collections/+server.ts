import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCollections, countRecords, getCollectionBySlug, ensureCollection } from '$lib/datastore';
import type { CollectionOptions } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../_util';

/** GET — every collection the owner can read, each with a live record count. */
export const GET: RequestHandler = async () => {
  try {
    const collections = await listCollections(ACTOR);
    const withCounts = await Promise.all(
      collections.map(async (c) => ({
        ...c,
        recordCount: await countRecords(c.slug, undefined, ACTOR),
      })),
    );
    return json({ collections: withCounts });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};

/** POST { slug, name?, description?, schema?, defaultPermissions?, settings? } — create a collection. */
export const POST: RequestHandler = async ({ request }) => {
  let body: { slug?: unknown } & CollectionOptions;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return json({ error: 'A collection slug is required' }, { status: 400 });

  try {
    if (await getCollectionBySlug(slug)) {
      return json({ error: `A collection "${slug}" already exists`, code: 'conflict' }, { status: 409 });
    }
    const opts: CollectionOptions = {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      schema: body.schema ?? null,
      defaultPermissions: body.defaultPermissions,
      settings: body.settings,
    };
    const collection = await ensureCollection(slug, opts, ACTOR);
    return json({ collection: { ...collection, recordCount: 0 } }, { status: 201 });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
