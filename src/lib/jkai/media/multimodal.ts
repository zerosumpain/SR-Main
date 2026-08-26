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
export async function buildMultimodalContent(
  text: string,
  attachments: JkaiAttachment[],
  opts?: { caps?: ModelCapabilities },
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  if (text && text.length > 0) parts.push({ type: 'text', text });
  for (const att of attachments) {
    const buf = await readBuffer(att.diskPath);

    // Can the model take this natively? No caps supplied means "assume yes",
    // preserving the original contract for callers that handle media themselves.
    const caps = opts?.caps;
    const native =
      !caps ||
      (att.kind === 'image' && caps.image) ||
      (att.kind === 'audio' && caps.audio) ||
      (att.kind === 'video' && caps.video) ||
      ((att.kind === 'pdf' || att.kind === 'document') && caps.pdf) ||
      att.kind === 'text';

    if (!native) {
      const outcome = await preanalyseAttachment(att, buf);
      parts.push({ type: 'text', text: preanalysisPartText(att, outcome) });
      continue;
    }

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
