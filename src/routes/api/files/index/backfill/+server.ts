// Backfill the global @files index: embed every /drive file that has never been
// indexed (content_hash IS NULL). Covers the pre-existing corpus and any file
// whose fire-and-forget embed was lost to a restart. Owner-only — the authed
// area is deny-by-default owner-only, so reaching this route already implies the
// owner, but we require a session for defence in depth.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { backfillMissing, indexedFileCount } from '$lib/file-index/store';

export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  if (!session?.user?.email) return json({ error: 'unauthorized' }, { status: 401 });
  return json({ indexedFiles: await indexedFileCount() });
};

export const POST: RequestHandler = async ({ locals, url }) => {
  const session = await locals.auth();
  if (!session?.user?.email) return json({ error: 'unauthorized' }, { status: 401 });
  // `?full=1` reconciles drift: scans every file and re-embeds only those whose
  // bytes changed (indexFile hash-gates). Default embeds only never-indexed files.
  const full = url.searchParams.get('full') === '1' || url.searchParams.get('full') === 'true';
  const result = await backfillMissing(full);
  return json({ ...result, indexedFiles: await indexedFileCount() });
};
