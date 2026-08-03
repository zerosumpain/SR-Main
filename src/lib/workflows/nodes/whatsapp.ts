import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import type { JkaiAttachment } from '$lib/db/schema';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { interpolateTemplate } from './template';
import { getWhatsAppService } from '../whatsapp/service';
import { markdownToWhatsApp, chunkMessage } from '../whatsapp/format';
// Single source of truth for the key name, shared with the canvas UI (the node
// inspector displays and clears it). Defined in that pure, fetch-free module so
// the browser never pulls this executor in just to learn the key's name — and
// so a rename here can't leave the panel clearing a key nothing writes.
import { WHATSAPP_SENT_HASHES_KEY } from '$lib/canvas/node-memory-keys';

export { whatsappDef } from './whatsapp.def';

/** Store key holding recently-sent message hashes for idempotency suppression. */
const SENT_HASHES_KEY = WHATSAPP_SENT_HASHES_KEY;
/** Cap on the remembered-hash ring buffer. */
const SENT_HASHES_MAX = 200;
/** Delay between sequential chunk sends so WhatsApp keeps them ordered. */
const CHUNK_GAP_MS = 600;

interface SentHash {
  h: string;
  ts: number;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(png)$/.test(lower)) return 'image/png';
  if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
  if (/\.(gif)$/.test(lower)) return 'image/gif';
  if (/\.(webp)$/.test(lower)) return 'image/webp';
  if (/\.(mp4|m4v)$/.test(lower)) return 'video/mp4';
  if (/\.(mov)$/.test(lower)) return 'video/quicktime';
  if (/\.(mp3)$/.test(lower)) return 'audio/mpeg';
  if (/\.(ogg|oga)$/.test(lower)) return 'audio/ogg';
  if (/\.(wav)$/.test(lower)) return 'audio/wav';
  if (/\.(pdf)$/.test(lower)) return 'application/pdf';
  return 'application/octet-stream';
}

function mediaKind(mime: string): JkaiAttachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Resolve the configured media reference to a local-disk attachment the
 * WhatsApp service can send. A `mediaPath` is used directly (the Hermes bridge
 * `/send-media` reads the absolute path). A `mediaUrl` is downloaded to a temp
 * file first and cleaned up afterwards. Media therefore requires the delegated
 * (Hermes bridge) mode, which reads a filesystem path.
 */
async function resolveMedia(
  mediaPath: string,
  mediaUrl: string,
  signal: AbortSignal,
): Promise<{ att: JkaiAttachment; cleanup?: () => Promise<void> }> {
  if (mediaPath) {
    const name = basename(mediaPath) || 'attachment';
    const mime = guessMime(name);
    return {
      att: {
        kind: mediaKind(mime),
        diskPath: mediaPath,
        mimeType: mime,
        originalName: name,
      } as unknown as JkaiAttachment,
    };
  }

  const res = await fetch(mediaUrl, { signal });
  if (!res.ok) {
    throw new Error(`whatsapp: media fetch failed (${res.status}) for ${mediaUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let name = 'media';
  try {
    name = basename(new URL(mediaUrl).pathname) || 'media';
  } catch {
    /* keep default */
  }
  const headerMime = res.headers.get('content-type')?.split(';')[0]?.trim();
  const mime = headerMime || guessMime(name);
  const tmp = join(tmpdir(), `wa-${randomUUID()}-${name}`);
  await writeFile(tmp, buf);
  return {
    att: {
      kind: mediaKind(mime),
      diskPath: tmp,
      mimeType: mime,
      originalName: name,
    } as unknown as JkaiAttachment,
    cleanup: async () => {
      await unlink(tmp).catch(() => {});
    },
  };
}

function normaliseMaxChunks(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 3;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : 3;
}

export const whatsappExecutor: NodeExecutor = {
  type: 'whatsapp',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const to = interpolateTemplate((config.to as string) || '', input);
    const formatMarkdown = config.formatMarkdown !== false; // default true

    let message = interpolateTemplate((config.message as string) || '', input);
    if (formatMarkdown && message) message = markdownToWhatsApp(message);

    const mediaPath = interpolateTemplate((config.mediaPath as string) || '', input).trim();
    const mediaUrl = interpolateTemplate((config.mediaUrl as string) || '', input).trim();
    const hasMedia = !!(mediaPath || mediaUrl);

    let caption = interpolateTemplate((config.caption as string) || '', input);
    if (formatMarkdown && caption) caption = markdownToWhatsApp(caption);
    // If no explicit caption but there's message text alongside media, the
    // (already-formatted) message doubles as the caption.
    if (hasMedia && !caption && message) caption = message;

    if (!to) {
      return { output: { sent: false, error: 'No recipient (to) configured' }, rowCount: 1 };
    }
    if (!message && !hasMedia) {
      return { output: { sent: false, error: 'No message content or media configured' }, rowCount: 1 };
    }

    // DRY RUN — send-free across EVERY path (text, media, suppression).
    if (context.dryRun) {
      return {
        output: {
          simulated: true,
          would_send: {
            to,
            message: message || null,
            media: mediaPath || mediaUrl || null,
            caption: caption || null,
          },
        },
        rowCount: 1,
        logs: [`[dry-run] would send WhatsApp to ${to}${hasMedia ? ' with media' : ''}`],
      };
    }

    const service = getWhatsAppService();

    // ---- Media send -----------------------------------------------------
    if (hasMedia) {
      const { att, cleanup } = await resolveMedia(mediaPath, mediaUrl, context.abortSignal);
      try {
        const result = await service.sendAttachment(to, att, caption || undefined);
        return {
          output: {
            sent: result.sent,
            messageId: result.messageId || null,
            error: result.error || null,
            media: true,
          },
          rowCount: 1,
        };
      } finally {
        await cleanup?.();
      }
    }

    // ---- Idempotency guard (text sends) --------------------------------
    const suppressWindowMins = Math.max(0, Number(config.suppressDuplicateWindowMins ?? 0) || 0);
    const workflowId = context.workflowId;
    let hash: string | null = null;
    if (suppressWindowMins > 0 && workflowId) {
      hash = sha256(`${to}\u0000${message}`);
      const { getStoreValue } = await import('./data-store');
      const { value } = await getStoreValue(workflowId, SENT_HASHES_KEY);
      const arr = (Array.isArray(value) ? value : []) as SentHash[];
      const windowMs = suppressWindowMins * 60_000;
      const now = Date.now();
      const duplicate = arr.some(
        (e) => e && e.h === hash && typeof e.ts === 'number' && now - e.ts <= windowMs,
      );
      if (duplicate) {
        return {
          output: { sent: false, suppressed: true, to },
          rowCount: 1,
          logs: [`[whatsapp] suppressed duplicate message within ${suppressWindowMins}m window`],
        };
      }
    }

    // ---- Chunked text send ---------------------------------------------
    const chunks = chunkMessage(message, normaliseMaxChunks(config.maxChunks));
    const messageIds: string[] = [];
    let allSent = true;
    let firstError: string | null = null;

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(CHUNK_GAP_MS, context.abortSignal);
      const result = await service.sendMessage(to, chunks[i]);
      if (result.sent) {
        if (result.messageId) messageIds.push(result.messageId);
      } else {
        allSent = false;
        firstError = result.error || 'send failed';
        break;
      }
    }

    // Record the hash only AFTER a fully-successful send.
    if (allSent && hash && workflowId) {
      const { appendAtomic } = await import('./data-store');
      await appendAtomic(workflowId, SENT_HASHES_KEY, [{ h: hash, ts: Date.now() }], SENT_HASHES_MAX);
    }

    return {
      output: {
        sent: allSent,
        messageId: messageIds[0] ?? null,
        messageIds,
        chunks: chunks.length,
        error: firstError,
        suppressed: false,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in to/message/caption/media fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        suppressed: { type: 'boolean', description: 'true when the send was skipped by the duplicate-suppression window' },
        messageId: { type: 'string' },
        messageIds: { type: 'array', description: 'One id per chunk when the message was split' },
        chunks: { type: 'number' },
        error: { type: 'string' },
      },
    };
  },
};
