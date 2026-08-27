// Taking email back out of the graph.
//
//   GET   a DRY RUN — exactly what a purge would delete, deleting nothing
//   POST { confirm: 'purge-email-from-graph' }   do it
//
// The confirmation phrase is not ceremony. This is the largest delete this
// graph will ever see — on production, 8,974 entities and 11,458 relationships
// — and a POST to a URL is far too easy to reach by accident from a script, a
// retry or a misremembered endpoint. The GET is free and answers the only
// question worth asking first: how much?
//
// Owner-gated by hooks.server.ts like every other /api/jkai route.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { purgeMailFromGraph, purgeMailAndRefresh } from '$lib/jkai/intel/mail-purge';

const CONFIRM = 'purge-email-from-graph';

export const GET: RequestHandler = async () => {
  return json(await purgeMailFromGraph({ dryRun: true }));
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine; it just will not carry the confirmation.
  }
  if (body.confirm !== CONFIRM) {
    return json(
      { error: `This deletes thousands of rows. Send { "confirm": "${CONFIRM}" } to proceed, or GET this URL for a dry run.` },
      { status: 400 },
    );
  }
  const noteIds = Array.isArray(body.noteIds)
    ? body.noteIds.map((v) => String(v ?? '').trim()).filter(Boolean)
    : undefined;
  return json(await purgeMailAndRefresh(noteIds?.length ? { noteIds } : {}));
};
