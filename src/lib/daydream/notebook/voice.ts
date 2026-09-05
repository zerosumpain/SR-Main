// The pure parts of a voice note: what a browser is allowed to send, and what a
// dictated note gets called.
//
// Separate from the route because a `+server.ts` may export only HTTP handlers
// — export a helper alongside them and SvelteKit rejects the whole module at
// runtime while the typecheck stays green. So anything worth testing lives here.

/** What a browser MediaRecorder actually produces, plus what a phone might. */
export const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac',
]);

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

/**
 * Normalise what the browser claims. MediaRecorder reports
 * `audio/webm;codecs=opus`, and an allowlist of bare types never matches that —
 * the same RFC 6838 parameter trap the chat attachments route documents.
 */
export function normaliseAudioMime(raw: string | null | undefined): string {
  return (raw ?? '').split(';', 1)[0].trim().toLowerCase();
}

export function isAllowedAudioMime(mime: string): boolean {
  return ALLOWED_AUDIO_MIME.has(mime);
}

/**
 * WebM and Ogg are CONTAINERS, and `file-type` reports the container, not what
 * is inside it. A browser MediaRecorder capturing microphone-only still writes
 * a Matroska/WebM container, so its blob sniffs as `video/webm` — which is why
 * an audio allowlist alone rejects the one format this feature actually
 * receives. Mapped back to audio only when the client also SAID audio, so an
 * upload that declares itself video is still refused.
 */
const CONTAINER_AS_AUDIO: Record<string, string> = {
  'video/webm': 'audio/webm',
  'video/ogg': 'audio/ogg',
  'video/x-matroska': 'audio/webm',
};

/**
 * Decide what an upload really is, or null to refuse it.
 *
 * The SNIFF is authoritative — `declared` only breaks the container tie above.
 * Trusting a declared type when the sniff comes back empty is what let a plain
 * text file through with `type=audio/webm` on it: every format here has magic
 * bytes, so "unsniffable" means "not one of these".
 */
export function resolveAudioMime(
  sniffed: string | null | undefined,
  declared: string | null | undefined,
): string | null {
  const s = normaliseAudioMime(sniffed);
  const d = normaliseAudioMime(declared);
  if (!s) return null;
  if (isAllowedAudioMime(s)) return s;
  const mapped = CONTAINER_AS_AUDIO[s];
  if (mapped && d.startsWith('audio/')) return mapped;
  return null;
}

export function extensionForAudioMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'webm';
}

/** Longest auto-title that still fits the note field at its display size. */
export const MAX_AUTO_TITLE = 48;

/**
 * A title for a note that arrived as speech.
 *
 * Dictation nearly always opens with what the note is about, so the first
 * sentence is the best candidate — but a title is a label, not the opening
 * line. Anything longer than the field can show only ever renders ellipsised,
 * and the full text is in the body regardless.
 */
export function titleFromTranscript(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (!line) return '';
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  const source = sentence.length <= MAX_AUTO_TITLE ? sentence : line;
  if (source.length <= MAX_AUTO_TITLE) return source.replace(/[.\s]+$/, '');
  const cut = source.slice(0, MAX_AUTO_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a word boundary if one falls somewhere useful — a 40-character
  // first word should be cut, not collapsed to nothing.
  const body = lastSpace > MAX_AUTO_TITLE / 2 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[.,\s]+$/, '')}…`;
}
