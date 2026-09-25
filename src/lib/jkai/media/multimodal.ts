import { readBuffer } from './storage';
import type { JkaiAttachment } from '$lib/db/schema';
import type { ModelCapabilities } from '$lib/server/models/capabilities';
import { preanalyseAttachment, preanalysisPartText } from './preanalyse';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

const AUDIO_FORMAT_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/mp4': 'mp4',
};

function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Build the content parts for a turn.
 *
 * `opts.caps` is what makes this safe on a model that cannot read the
 * attachment. Omit it and behaviour is exactly as before — every attachment
 * becomes a native part — which is right for a caller that does its own
 * media handling. Pass it and any modality the model does not accept is
 * pre-analysed into text instead of being sent as a part the provider will
 * reject or silently drop.
 *
 * Note this is called for HISTORY as well as the current turn, so caching in
 * `preanalyseAttachment` is not an optimisation — without it an image is
 * re-described on every turn for the life of the thread.
 */
/**
 * Whether `caps` lets this attachment travel as its own part. No caps means
 * "assume yes", the original contract for callers that handle media themselves.
 */
export function isNativeFor(att: JkaiAttachment, caps?: ModelCapabilities): boolean {
  return (
    !caps ||
    (att.kind === 'image' && caps.image) ||
    (att.kind === 'audio' && caps.audio) ||
    (att.kind === 'video' && caps.video) ||
    ((att.kind === 'pdf' || att.kind === 'document') && caps.pdf) ||
    att.kind === 'text'
  );
}

/**
 * How many encoded bytes of files one chat request may carry.
 *
 * Every turn re-sends the thread, so a photo sent natively is sent again on
 * every later turn, and on every tool round of each. That is the point (the
 * model keeps looking at the picture, not at a paragraph about it), but it has
 * a ceiling: the Codex bridge refuses a body over 32MB, and a few full-size
 * photos from the web composer (15MB each) would pass it. Newest first, so the
 * picture being talked about is the one that stays; anything older that does
 * not fit falls back to its cached description.
 */
export const MEDIA_BUDGET_BYTES = Number(process.env.JKAI_MEDIA_BUDGET_BYTES ?? 20 * 1024 * 1024);

/** The same model, reading nothing natively: every file pre-analysed to text. */
const TEXT_ONLY_CAPS: ModelCapabilities = {
  image: false, audio: false, video: false, pdf: false, documentText: true,
};

/**
 * Which caps each turn's files are built with, newest turn first, so a thread
 * never sends more native media than `MEDIA_BUDGET_BYTES`.
 *
 * `turns` is ordered oldest to newest, the current message LAST; the result is
 * in the same order. A turn whose native files would overflow what is left gets
 * text-only caps (all of its files described), and the walk carries on, so a
 * small older photo can still fit behind a large newer PDF.
 */
export function allocateMediaCaps(
  turns: JkaiAttachment[][],
  caps: ModelCapabilities,
  budget = MEDIA_BUDGET_BYTES,
): ModelCapabilities[] {
  const out: ModelCapabilities[] = new Array(turns.length);
  let left = budget;
  for (let i = turns.length - 1; i >= 0; i--) {
    // Text files ride as text whatever the caps; only true media is counted.
    const bytes = turns[i]
      .filter((a) => a.kind !== 'text' && isNativeFor(a, caps))
      .reduce((n, a) => n + Math.ceil((a.sizeBytes * 4) / 3), 0);
    if (bytes <= left) {
      left -= bytes;
      out[i] = caps;
    } else {
      out[i] = TEXT_ONLY_CAPS;
    }
  }
  return out;
}

export async function buildMultimodalContent(
  text: string,
  attachments: JkaiAttachment[],
  opts?: { caps?: ModelCapabilities },
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  if (text && text.length > 0) parts.push({ type: 'text', text });
  for (const att of attachments) {
    const buf = await readBuffer(att.diskPath);

    if (!isNativeFor(att, opts?.caps)) {
      const outcome = await preanalyseAttachment(att, buf);
      parts.push({ type: 'text', text: preanalysisPartText(att, outcome) });
      continue;
    }

    const label = nativeLabel(att);
    if (label) parts.push({ type: 'text', text: label });

    if (att.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'audio') {
      const format = AUDIO_FORMAT_MAP[att.mimeType] ?? 'mp3';
      parts.push({ type: 'input_audio', input_audio: { data: buf.toString('base64'), format } });
    } else if (att.kind === 'video') {
      parts.push({ type: 'video_url', video_url: { url: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'pdf' || att.kind === 'document') {
      parts.push({ type: 'file', file: { filename: att.originalName ?? (att.kind === 'pdf' ? 'file.pdf' : 'document'), file_data: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'text') {
      const name = att.originalName ?? 'file';
      const body = buf.toString('utf8');
      parts.push({
        type: 'text',
        text: `\n\n--- File: ${name} (${att.mimeType}, ${body.length} chars) ---\n${body}\n--- end ---`,
      });
    }
  }
  return parts;
}

/**
 * One line naming a file the model is about to see, and where it is kept.
 *
 * A native part carries pixels and nothing else, so without this the model
 * cannot say which photo it is looking at, and does not know the original is in
 * /drive. `drivePath` is stamped on the attachment by the /drive mirror
 * (`$lib/file-index/jkai-mirror`); before that lands the line names the file only.
 */
export function nativeLabel(att: JkaiAttachment): string | null {
  if (att.kind === 'text') return null; // its own header already names it
  const meta = (att.metadata ?? {}) as { drivePath?: unknown };
  const name = att.originalName ? ` "${att.originalName}"` : '';
  const where = typeof meta.drivePath === 'string' ? `, kept in /drive as "${meta.drivePath}"` : '';
  return `[Attached ${att.kind}${name}${where}]`;
}

export function encodedSizeBytes(parts: ContentPart[]): number {
  let n = 0;
  for (const p of parts) {
    if (p.type === 'text') n += p.text.length;
    else if (p.type === 'image_url') n += p.image_url.url.length;
    else if (p.type === 'input_audio') n += p.input_audio.data.length;
    else if (p.type === 'video_url') n += p.video_url.url.length;
    else if (p.type === 'file') n += p.file.file_data.length;
  }
  return n;
}
