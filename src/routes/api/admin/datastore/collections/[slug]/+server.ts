import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCollectionBySlug, countRecords, updateCollection, deleteCollection } from '$lib/datastore';
import type { CollectionOptions } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../../_util';

/** GET — collection metadata + live record count (404 when the slug is unknown). */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const collection = await getCollectionBySlug(params.slug);
    if (!collection) return json({ error: `Collection "${params.slug}" not found` }, { status: 404 });
    const recordCount = await countRecords(collection.slug, undefined, ACTOR);
    return json({ collection: { ...collection, recordCount } });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};

/** PATCH { name?, description?, schema?, defaultPermissions?, settings? } — edit metadata. */
export const PATCH: RequestHandler = async ({ params, request }) => {
  let body: CollectionOptions;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: CollectionOptions = {};
  if ('name' in body) patch.name = body.name;
  if ('description' in body) patch.description = body.description;
  if ('schema' in body) patch.schema = body.schema ?? null;
  if ('defaultPermissions' in body) patch.defaultPermissions = body.defaultPermissions;
  if ('settings' in body) patch.settings = body.settings;

  try {
    const collection = await updateCollection(params.slug, patch, ACTOR);
    const recordCount = await countRecords(collection.slug, undefined, ACTOR);
    return json({ collection: { ...collection, recordCount } });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};

/** DELETE — remove a non-system collection (system collections → 403). */
export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const result = await deleteCollection(params.slug, ACTOR);
    return json(result);
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
