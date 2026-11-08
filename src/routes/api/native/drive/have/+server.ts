import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, haveFiles, parseSpace } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/have?space=mine|shared — JSON `{items:[{sha256,size}]}`
 * (up to 500). 200 `{have:[{sha256,file}], unchecked}`: which of the phone's
 * photos the space already holds, so photo sync sends only the rest. Relayed
 * to SR-Drive, which answers from its fingerprints without reading the store.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const body = await event.request.json().catch(() => null);
  return json(await haveFiles(await driveCaller(event, identity, role), space, body));
});
