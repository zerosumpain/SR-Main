import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { insertRecord } from '$lib/datastore';
import type { RecordInput } from '$lib/datastore';
import { ACTOR, datastoreErrorResponse } from '../../../_util';

/** POST { key?, data, permissions?, expiresAt? } — insert a new record. */
export const POST: RequestHandler = async ({ params, request }) => {
  let body: {
    key?: unknown;
    data?: unknown;
    permissions?: RecordInput['permissions'];
    expiresAt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return json({ error: 'Record `data` must be a JSON object' }, { status: 400 });
  }

  const input: RecordInput = {
    key: typeof body.key === 'string' && body.key.trim() ? body.key.trim() : undefined,
    data: body.data as Record<string, unknown>,
    permissions: body.permissions,
    expiresAt: typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : undefined,
  };

  try {
    const record = await insertRecord(params.slug, input, ACTOR);
    return json({ record }, { status: 201 });
  } catch (err) {
    return datastoreErrorResponse(err);
  }
};
