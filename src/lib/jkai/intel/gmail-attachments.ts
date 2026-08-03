// Attachment text for Gmail threads swept into the intel graph.
//
// The body of an email is often a covering note — "see attached" — and the
// actual intelligence is in the document. Ingesting the thread without its
// attachments therefore captures the fact that a conversation happened and
// almost none of what it was about.
//
// Two halves, split so the decisions are testable without a Gmail client:
//
//   planAttachments()  — pure. Which attachments are worth fetching, in what
//                        order, inside what budget. All the judgement lives
//                        here.
//   fetchAttachmentText() / attachmentSection() — the I/O and the formatting.
//
// Extraction itself is NOT reimplemented: `$lib/jkai/extract` already handles
// pdf/docx/pptx/xlsx/csv/text for /drive, and this uses it unchanged. Audio and
// video are deliberately excluded even though that extractor supports them —
// transcribing every voice note in a 12-week mailbox is a cost nobody asked
// for, and a mail attachment is far more likely to be a ringtone than a
// briefing.
import { kindFromMime, type ExtractKind } from '$lib/jkai/extract/types';

/** Structurally satisfied by `GmailAttachmentRef`, declared minimally so the
 *  pure planner can be tested with a literal. */
export interface AttachmentRefInput {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PlannedAttachment extends AttachmentRefInput {
  kind: ExtractKind;
}

export interface AttachmentPlan {
  /** Fetch and extract these, in order. */
  fetch: PlannedAttachment[];
  /** Named in the note but not decoded, with the reason why. */
  skipped: Array<{ filename: string; reason: string }>;
}

/**
 * Kinds worth decoding from a mailbox. See the module note on audio/video.
 */
const INGESTIBLE: ReadonlySet<ExtractKind> = new Set<ExtractKind>([
  'pdf', 'docx', 'doc', 'pptx', 'markdown', 'text', 'spreadsheet',
]);

/** Per-attachment ceiling. Well under the extractor's 50 MB — a 25 MB
 *  spreadsheet in an email is a data dump, not an argument. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Attachments decoded per thread. Beyond this the marginal one is noise. */
export const MAX_ATTACHMENTS_PER_THREAD = 5;

/** Characters kept from any single attachment, so one 300-page PDF cannot
 *  crowd out the conversation it arrived with. */
export const MAX_ATTACHMENT_CHARS = 12_000;

/**
 * Inline images and signature logos arrive as real attachments. They are never
 * intelligence and there are a lot of them.
 */
function isDecorative(ref: AttachmentRefInput): boolean {
  const name = (ref.filename || '').toLowerCase();
  if (/^(image|logo|signature|icon|banner)[-_ ]?\d*\.(png|jpe?g|gif|bmp|webp|svg)$/.test(name)) return true;
  if (/\.(png|jpe?g|gif|bmp|webp|svg|ico)$/.test(name)) return true;
  // Calendar invites are structured data the graph reads from headers already.
  if (/\.(ics|vcf)$/.test(name)) return true;
  return false;
}

/**
 * Which attachments to decode, largest-value first.
 *
 * Ordered by kind then size: a PDF or document is more likely to carry the
 * substance than a spreadsheet, and within a kind the bigger file is usually
 * the report rather than the covering slip. Deterministic, so re-running a
 * sweep decodes the same set.
 */
export function planAttachments(
  refs: AttachmentRefInput[],
  opts: { maxCount?: number; maxBytes?: number } = {},
): AttachmentPlan {
  const maxCount = opts.maxCount ?? MAX_ATTACHMENTS_PER_THREAD;
  const maxBytes = opts.maxBytes ?? MAX_ATTACHMENT_BYTES;

  const fetch: PlannedAttachment[] = [];
  const skipped: AttachmentPlan['skipped'] = [];

  const candidates: PlannedAttachment[] = [];
  for (const ref of refs ?? []) {
    if (!ref?.attachmentId || !ref.filename) continue;

    if (isDecorative(ref)) {
      skipped.push({ filename: ref.filename, reason: 'image or calendar attachment' });
      continue;
    }
    if (ref.sizeBytes > maxBytes) {
      skipped.push({ filename: ref.filename, reason: `too large (${Math.round(ref.sizeBytes / 1024 / 1024)} MB)` });
      continue;
    }
    const kind = kindFromMime(ref.mimeType, ref.filename);
    if (!kind || !INGESTIBLE.has(kind)) {
      skipped.push({ filename: ref.filename, reason: `unsupported type (${ref.mimeType || 'unknown'})` });
      continue;
    }
    candidates.push({ ...ref, kind });
  }

  const KIND_RANK: Record<string, number> = {
    pdf: 0, docx: 1, doc: 1, pptx: 2, markdown: 3, text: 3, spreadsheet: 4,
  };
  candidates.sort((a, b) => {
    const ra = KIND_RANK[a.kind] ?? 9;
    const rb = KIND_RANK[b.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return a.filename.localeCompare(b.filename);
  });

  for (const c of candidates) {
    if (fetch.length >= maxCount) {
      skipped.push({ filename: c.filename, reason: 'over the per-thread attachment budget' });
      continue;
    }
    fetch.push(c);
  }

  return { fetch, skipped };
}

/**
 * The block appended to a thread's note text for one attachment.
 *
 * Headed and delimited so the extractor can tell document text from message
 * text — an attachment's contents are evidence *carried by* the thread, not
 * something a participant wrote in it.
 */
export function attachmentSection(filename: string, text: string, maxChars = MAX_ATTACHMENT_CHARS): string {
  const body = (text ?? '').trim();
  if (!body) return '';
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n[… attachment truncated]` : body;
  return `--- Attachment: ${filename} ---\n${clipped}`;
}

/** The trailing "not decoded" line, so a skipped attachment is still on the record. */
export function skippedAttachmentsNote(skipped: AttachmentPlan['skipped']): string {
  if (!skipped.length) return '';
  const names = skipped.map((s) => `${s.filename} (${s.reason})`).join(', ');
  return `--- Attachments not read: ${names} ---`;
}

/**
 * Download one attachment and extract its text. Returns null when the
 * attachment cannot be read — a bad attachment must never cost the thread.
 *
 * `gmailClient` is the authenticated `gmail_v1.Gmail` from
 * $lib/workflows/gmail/service, passed in rather than constructed so this stays
 * one client-per-sweep and the module needs no `$env` import.
 */
export async function fetchAttachmentText(
  gmailClient: {
    users: {
      messages: {
        attachments: {
          get(params: { userId: string; messageId: string; id: string }): Promise<{ data: { data?: string | null } }>;
        };
      };
    };
  },
  messageId: string,
  ref: PlannedAttachment,
): Promise<string | null> {
  try {
    const res = await gmailClient.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: ref.attachmentId,
    });
    const b64 = res.data?.data;
    if (!b64) return null;

    // Gmail returns base64url, not standard base64.
    const buffer = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (!buffer.byteLength || buffer.byteLength > MAX_ATTACHMENT_BYTES) return null;

    const { extractText } = await import('$lib/jkai/extract');
    const result = await extractText(buffer, ref.mimeType, ref.filename);
    return (result?.text ?? '').trim() || null;
  } catch (err) {
    console.warn(
      `[intel:gmail] attachment ${ref.filename} unreadable:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
