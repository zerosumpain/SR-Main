import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCollectionBySlug, queryRecords, countRecords } from '$lib/datastore';

export const load: PageServerLoad = async ({ params }) => {
  const collection = await getCollectionBySlug(params.slug);
  if (!collection) throw error(404, `Collection "${params.slug}" not found`);

  const [{ records }, recordCount] = await Promise.all([
    queryRecords(params.slug, { sort: { field: 'updatedAt', dir: 'desc' }, limit: 50 }, 'owner'),
    countRecords(params.slug, undefined, 'owner'),
  ]);

  return { collection, records, recordCount };
};
