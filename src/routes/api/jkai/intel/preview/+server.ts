// Dry-run ingest — what an extraction WOULD change, without changing anything.
//
//   POST { text, format? } → the classified diff (new / existing / conflict)
//
// READ-ONLY BY CONSTRUCTION. There is no note row, no entity write, no
// embedding and no alert on this path: `previewExtraction` runs the extractor
// and then only reads. That is the entire contract of this route, so keep it —
// anything that persists belongs on /api/jkai/intel/ingest instead.
//
// Opt-in: nothing in the ingest pipeline calls this. It costs the same model
// call as a real extraction, so it runs when someone asks for it and not
// otherwise. Owner-gated by hooks.server.ts like every /api/jkai route.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  MAX_PREVIEW_CHARS,
  MIN_PREVIEW_CHARS,
  previewExtraction,
} from '$lib/jkai/intel/ingest-preview';

/** Mirrors the formats intel notes are stored under (see $lib/jkai/intel/ingest). */
const VALID_FORMATS = new Set([
  'text',
  'handwriting_scan',
  'audio_transcript',
  'email',
  'meeting_transcript',
  'summary',
]);

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; format?: unknown };

  const text = typeof body.text === 'string' ? body.text : '';
  if (text.trim().length < MIN_PREVIEW_CHARS) {
    return json(
      { error: `text is required and must be at least ${MIN_PREVIEW_CHARS} characters` },
      { status: 400 },
    );
  }

  const requested = typeof body.format === 'string' ? body.format : 'text';
  const format = VALID_FORMATS.has(requested) ? requested : 'text';

  try {
    const preview = await previewExtraction(text, format);
    return json({ ...preview, maxChars: MAX_PREVIEW_CHARS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[intel:preview] failed:', message);
    return json({ error: message }, { status: 502 });
  }
};
