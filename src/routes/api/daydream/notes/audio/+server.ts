// Record a voice note: store the audio, transcribe it, put the words in the note.
//
// Owner-gated by hooks like the rest of `/api/daydream/notes` — NOT in
// PUBLIC_PATHS and must never be. This carries the owner's own dictation.
//
// A separate route from the JSON action endpoint next door because this one
// takes multipart bytes, which is the same split `/api/jkai/attachments` makes
// against the chat's JSON routes. Storage and transcription live HERE rather
// than in `$lib/daydream/notebook/store`, so the store keeps its `$lib/db`-only
// dependency and no `daydream -> jkai` edge is created for the boundary gate to
// grow a cycle out of later.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileTypeFromBuffer } from 'file-type';
import { saveBuffer } from '$lib/jkai/media/storage';
import { extractAudio } from '$lib/jkai/extract/audio';
import { errMsg } from '$lib/daydream/types';
import {
  addRecording,
  appendTranscriptToBody,
  getNote,
  listRecordings,
  saveNote,
} from '$lib/daydream/notebook/store';
import {
  extensionForAudioMime,
  resolveAudioMime,
  titleFromTranscript,
} from '$lib/daydream/notebook/voice';

/** The chat composer's audio ceiling. A dictated note is minutes, not hours. */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw error(400, 'expected multipart/form-data');
  }

  const file = form.get('audio');
  if (!(file instanceof File)) throw error(400, 'audio is required');
  if (file.size === 0) throw error(400, 'audio is empty');
  if (file.size > MAX_AUDIO_BYTES) throw error(413, `audio too large (limit ${MAX_AUDIO_BYTES} bytes)`);

  // `noteId` absent means "make a new note from this"; present means "append to
  // the one I have open". Both are real ways to speak into a notebook.
  const noteId = typeof form.get('noteId') === 'string' ? (form.get('noteId') as string) : '';
  const folder = typeof form.get('folder') === 'string' ? (form.get('folder') as string) : '';
  const durationRaw = Number(form.get('durationSec'));
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;

  const buf = Buffer.from(await file.arrayBuffer());
  // The sniff is authoritative; `file.type` only breaks the container tie.
  // See resolveAudioMime — a MediaRecorder blob sniffs as `video/webm` because
  // WebM is a container, and a file with no magic bytes at all is refused
  // outright however the page labels it.
  const sniffed = (await fileTypeFromBuffer(buf))?.mime;
  const mime = resolveAudioMime(sniffed, file.type);
  if (!mime) throw error(415, `unsupported audio type: ${sniffed || file.type || 'unknown'}`);

  // The note has to exist before the recording row can reference it, and the
  // transcript is what titles a new one — so a new note is created empty here
  // and titled below, once there are words to title it with.
  let targetId = noteId;
  if (targetId) {
    if (!(await getNote(targetId))) throw error(404, 'no such note');
  } else {
    const created = await saveNote({ title: '', body: '', folder: folder || undefined });
    targetId = created.id;
  }

  const ext = extensionForAudioMime(mime);
  const { diskPath, sizeBytes } = await saveBuffer(buf, ext);

  let transcript = '';
  let language: string | null = null;
  // Which path ran is worth recording: local is free, remote is metered on the
  // one key whose outage is a total LLM outage. Read off the RESULT rather than
  // guessed from availability beforehand — extractAudio falls back to the paid
  // path when a local attempt fails, and a label that said 'local' anyway would
  // be worse than no label.
  let engine: string | null = null;
  // The transcriber knows the real duration; the browser only knows how long it
  // held the button. Prefer the former when it is offered.
  let measured: number | null = null;
  try {
    const out = await extractAudio(buf, mime, file.name || `voice.${ext}`);
    transcript = (out.text ?? '').trim();
    const meta = out.meta as { language?: string; engine?: string; durationSec?: number } | undefined;
    language = meta?.language ?? null;
    engine = meta?.engine ?? null;
    measured = Number.isFinite(meta?.durationSec) ? (meta?.durationSec as number) : null;
  } catch (err) {
    // The audio is the thing that cannot be recreated, so it stays. The row
    // records a null transcript, which the page offers to retry.
    console.error('[notebook] transcription failed:', errMsg(err));
    const recording = await addRecording({
      noteId: targetId,
      mimeType: mime,
      sizeBytes,
      diskPath,
      durationSec,
      transcript: null,
      language: null,
      engine: null,
    });
    return json(
      {
        ok: false,
        error: `Saved the recording, but transcription failed: ${errMsg(err)}`,
        note: await getNote(targetId),
        recording,
        recordings: await listRecordings(targetId),
      },
      { status: 200 },
    );
  }

  const recording = await addRecording({
    noteId: targetId,
    mimeType: mime,
    sizeBytes,
    diskPath,
    durationSec: measured ?? durationSec,
    transcript,
    language,
    engine,
  });

  // Empty string, not null: a silent recording transcribed to nothing is a real
  // outcome, and must not read back as "not transcribed yet".
  let note = await appendTranscriptToBody(targetId, transcript);
  if (!noteId && transcript) {
    const title = titleFromTranscript(transcript);
    if (title) note = await saveNote({ id: targetId, title });
  }

  return json({ ok: true, note, recording, recordings: await listRecordings(targetId) });
};
