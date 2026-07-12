// Owner-only (hooks gate, same as ../import): accept a file from the editor's
// UPLOAD tab and persist it via the blog image pipeline under deck-media.
// Images return a ready image-block payload; mp4/webm return kind "video" so
// the picker inserts a video block instead.

import { json } from '@sveltejs/kit';
import { storeUpload } from '$lib/decks/image-sources.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'multipart form-data required' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'file field required' }, { status: 400 });
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await storeUpload(buf, file.type || 'application/octet-stream', file.name || 'upload');
    return json({ ok: true, ...stored });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'upload failed' }, { status: 400 });
  }
};
