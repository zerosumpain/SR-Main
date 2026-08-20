// Turn stored jkai attachment rows into the inline payload Hermes' jkai_platform
// plugin accepts on `POST /platforms/jkai/msg`.
//
// Why the bytes travel inline rather than as a URL Hermes fetches: Hermes runs
// on homeserv ONLY, while the attachment file lives on whichever host took the
// upload — the VPS for a production chat. A URL would mean opening an
// authenticated public read route for arbitrary attachment bytes and depending
// on Hermes being able to reach it; the /msg POST is a channel that already
// works in both directions, so we reuse it. The plugin writes the bytes into
// Hermes' own media cache and hands the agent local paths, which is what
// `MessageEvent.media_urls` expects (see whatsapp_cloud.py for the same shape
// built from a download instead).
//
// Mirrors `buildMultimodalContent` in ./multimodal.ts, which does the equivalent
// job for the legacy in-process chat lane (data-URL content parts).

import { readBuffer } from './storage';
import type { JkaiAttachment } from '$lib/db/schema';

/** One attachment as the Hermes plugin's `/msg` body carries it. snake_case
 *  because the plugin reads it straight off the JSON body alongside `chat_id`,
 *  `turn_id` and friends. */
export interface HermesInboundAttachment {
  id: string;
  kind: string;
  mime_type: string;
  original_name: string | null;
  size_bytes: number;
  /** Base64 of the raw file. */
  data_b64: string;
}

/**
 * Total raw bytes we will inline into a single `/msg` POST.
 *
 * Both sides buffer the whole body in memory and base64 inflates it by ~4/3, so
 * this is the number that bounds the spike — not the per-kind upload limits in
 * `POST /api/jkai/attachments` (video allows 200MB, which must never reach a
 * single JSON body). The plugin's aiohttp app is configured to accept the
 * base64-inflated equivalent of this; keep the two in step.
 */
export const HERMES_ATTACHMENT_BUDGET_BYTES = 48 * 1024 * 1024;

export interface HermesAttachmentPayload {
  attachments: HermesInboundAttachment[];
  /** Rows left out — over budget or unreadable. Named so the caller can tell
   *  the model (and the log) what it is not seeing, rather than the attachment
   *  vanishing silently the way it did before this path existed at all. */
  skipped: Array<{ id: string; name: string; reason: 'over-budget' | 'unreadable' }>;
}

/** Read each attachment's bytes and base64 them, in order, until the budget runs
 *  out. A row that cannot be read is skipped rather than throwing: losing one
 *  attachment must not cost the user the whole turn. */
export async function buildHermesAttachments(
  rows: JkaiAttachment[],
  budgetBytes: number = HERMES_ATTACHMENT_BUDGET_BYTES,
): Promise<HermesAttachmentPayload> {
  const attachments: HermesInboundAttachment[] = [];
  const skipped: HermesAttachmentPayload['skipped'] = [];
  let spent = 0;

  for (const row of rows) {
    const name = row.originalName ?? row.id;
    if (spent + row.sizeBytes > budgetBytes) {
      skipped.push({ id: row.id, name, reason: 'over-budget' });
      continue;
    }
    let buf: Buffer;
    try {
      buf = await readBuffer(row.diskPath);
    } catch {
      skipped.push({ id: row.id, name, reason: 'unreadable' });
      continue;
    }
    // The pre-check used the recorded size to avoid reading a file we already
    // know is too big; this one uses what was actually read, so a row whose
    // `size_bytes` under-reports can't quietly overrun the budget.
    if (spent + buf.byteLength > budgetBytes) {
      skipped.push({ id: row.id, name, reason: 'over-budget' });
      continue;
    }
    spent += buf.byteLength;
    attachments.push({
      id: row.id,
      kind: row.kind,
      mime_type: row.mimeType,
      original_name: row.originalName,
      size_bytes: buf.byteLength,
      data_b64: buf.toString('base64'),
    });
  }

  return { attachments, skipped };
}

/** A line appended to the outbound message naming what did not make it, so the
 *  model answers "I can't see the 200MB clip" instead of ignoring a file the
 *  user can see in their own bubble. Empty string when nothing was skipped. */
export function skippedAttachmentNote(skipped: HermesAttachmentPayload['skipped']): string {
  if (skipped.length === 0) return '';
  const parts = skipped.map((s) =>
    s.reason === 'over-budget' ? `${s.name} (too large to send)` : `${s.name} (file missing)`,
  );
  return `\n\n[Attached but not delivered to you: ${parts.join(', ')}]`;
}
