import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import type { DatastoreRecord } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../../../_util';

const PAGE = 500; // access-layer limit cap
const SAFETY_CAP = 50000; // matches default maxRecords

/** GET — download the whole collection (metadata + every record) as a JSON file. */
export const GET: RequestHandler = async ({ params }) => {
  try {
    const collection = await getCollectionBySlug(params.slug);
    if (!collection) return json({ error: `Collection "${params.slug}" not found` }, { status: 404 });

    const records: DatastoreRecord[] = [];
    for (let offset = 0; offset < SAFETY_CAP; offset += PAGE) {
      const { records: batch } = await queryRecords(
        params.slug,
        { sort: { field: 'createdAt', dir: 'asc' }, limit: PAGE, offset },
        ACTOR,
      );
      records.push(...batch);
      if (batch.length < PAGE) break;
    }

    const payload = {
      collection: {
        slug: collection.slug,
        name: collection.name,
        description: collection.description,
        schema: collection.schema,
        defaultPermissions: collection.defaultPermissions,
        settings: collection.settings,
        isSystem: collection.isSystem,
      },
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="datastore-${collection.slug}-${stamp}.json"`,
      },
    });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
