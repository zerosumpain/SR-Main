import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queryRecords } from '$lib/datastore';
import type { QueryOptions } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../../../_util';

/**
 * POST QueryOptions ({ filters?, sort?, limit?, offset?, includeTotal? }) — run a
 * query against the collection. Path validation / operator errors surface as 400
 * via the DatastoreError mapping; the access layer clamps limit/offset itself.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  let opts: QueryOptions;
  try {
    opts = (await request.json()) as QueryOptions;
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const result = await queryRecords(params.slug, opts ?? {}, ACTOR);
    return json(result);
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
