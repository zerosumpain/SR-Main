import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { analyseFile, driveCaller } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/files/:id/analyse `{refresh?}` — jkai's summary of one
 * of the owner's files (a FileAnalysis). Owner only: a member's phone, or the
 * owner viewing as a member, gets 403 before Drive is asked.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const caller = await driveCaller(event, identity, role);
  const body = (await event.request.json().catch(() => ({}))) as { refresh?: unknown } | null;
  return analyseFile(caller, event.params.id, body?.refresh === true);
});
