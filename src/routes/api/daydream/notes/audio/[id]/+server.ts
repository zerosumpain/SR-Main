// Serve and delete one voice recording.
//
// Reached through its note (`requireRecording`): the owner, or a `jkai.notes`
// member for a recording on a note they may read (delete: change). A notebook
// recording is someone speaking privately; it must never become anonymously
// readable, so this route stays out of PUBLIC_PATHS.
//
// Modelled on `/api/jkai/attachments/[id]`, which does the same two jobs for
// chat attachments — same headers, same 410 when the row outlives its bytes.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readBuffer, deleteByDiskPath } from '$lib/jkai/media/storage';
import { getRecordingWithPath, deleteRecording } from '$lib/daydream/notebook/store';
import { requireRecording } from '$lib/daydream/notebook/access.server';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  await requireRecording(event, params.id!, 'read');
  const found = await getRecordingWithPath(params.id!);
  if (!found) throw error(404, 'recording not found');
  let buf: Buffer;
  try {
    buf = await readBuffer(found.diskPath);
  } catch {
    throw error(410, 'recording file missing from the media store');
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': found.recording.mimeType,
      'Content-Length': String(found.recording.sizeBytes),
      'Content-Disposition': `inline; filename="voice-${found.recording.id}"`,
      // Private: this is dictation, and a shared cache must never hold it.
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  await requireRecording(event, params.id!, 'write');
  const found = await getRecordingWithPath(params.id!);
  if (!found) throw error(404, 'recording not found');
  // Bytes first: a failure here leaves a row pointing at a file that is still
  // there, which the GET above can still serve. The other order leaves an
  // unreachable file behind for ever.
  await deleteByDiskPath(found.diskPath);
  await deleteRecording(found.recording.id);
  // The transcript stays in the note body on purpose — the words are the
  // owner's, and deleting the audio is not a request to unwrite them.
  return json({ deleted: true });
};
