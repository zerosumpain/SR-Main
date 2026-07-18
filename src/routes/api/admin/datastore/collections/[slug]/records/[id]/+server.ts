import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateRecord, deleteRecord } from '$lib/datastore';
import type { RecordChanges } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../../../../_util';

/**
 * PATCH { data?, patch?, permissions?, expiresAt?, expectedVersion? } — update a
 * record. `data` replaces, `patch` shallow-merges; `permissions` rewrites the
 * row-level capability map; `expectedVersion` opts into optimistic concurrency.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  let body: {
    data?: unknown;
    patch?: unknown;
    permissions?: RecordChanges['permissions'];
    expiresAt?: unknown;
    expectedVersion?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const changes: RecordChanges = {};
  if ('data' in body && body.data !== undefined) {
    if (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return json({ error: '`data` must be a JSON object' }, { status: 400 });
    }
    changes.data = body.data as Record<string, unknown>;
  }
  if ('patch' in body && body.patch !== undefined) {
    if (body.patch === null || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      return json({ error: '`patch` must be a JSON object' }, { status: 400 });
    }
    changes.patch = body.patch as Record<string, unknown>;
  }
  if ('permissions' in body) changes.permissions = body.permissions;
  if ('expiresAt' in body) {
    changes.expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;
  }
  if (typeof body.expectedVersion === 'number') changes.expectedVersion = body.expectedVersion;

  try {
    const record = await updateRecord(params.slug, { id: params.id }, changes, ACTOR);
    return json({ record });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};

/** DELETE — remove a single record by id. */
export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const result = await deleteRecord(params.slug, { id: params.id }, ACTOR);
    return json(result);
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
