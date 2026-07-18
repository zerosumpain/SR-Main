import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { getCollectionBySlug } from '$lib/datastore';
import { datastoreErrorResponse } from '../../../_util';

// The audit log has no dedicated access-layer reader (audit.ts only writes), so
// this thin route reads datastore_audit_log directly, scoped to the collection.
// It doubles as the record-level revision history the admin drawer restores from.

type Row = Record<string, unknown>;
function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

/** GET [?recordId=] — the most recent audit entries for a collection (or one record). */
export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const collection = await getCollectionBySlug(params.slug);
    if (!collection) return json({ error: `Collection "${params.slug}" not found` }, { status: 404 });

    const recordId = url.searchParams.get('recordId');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 200);

    const res = recordId
      ? await db.execute(sql`
          SELECT id, record_id, actor, action, before, after, created_at
          FROM datastore_audit_log
          WHERE collection_id = ${collection.id} AND record_id = ${recordId}
          ORDER BY created_at DESC LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT id, record_id, actor, action, before, after, created_at
          FROM datastore_audit_log
          WHERE collection_id = ${collection.id}
          ORDER BY created_at DESC LIMIT ${limit}
        `);

    const entries = rowsOf(res).map((r) => ({
      id: String(r.id),
      recordId: (r.record_id as string) ?? null,
      actor: (r.actor as string) ?? null,
      action: (r.action as string) ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
      createdAt: r.created_at,
    }));
    return json({ entries });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
