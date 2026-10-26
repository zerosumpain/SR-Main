// A capture into the intel graph, through the outbox. Main never writes intel
// rows: it queues an `extract` job and SR-Jkai-Core does the work.
//
// The ids, per CONTRACT.md "Core notes": the outbox `ref` is `capture:<id>`,
// the payload `refId` is the BARE capture id, and that same bare id is what
// `derived-delete` and the search join use. Three places, one string — if they
// differ, a delete finds nothing and the capture's entities outlive it.

import { createHash } from 'node:crypto';
import type { Capture } from '$lib/db/schema';
import { enqueueIntelJob } from '$lib/intel-client/outbox';
import { MIN_EXTRACT_CHARS } from '$lib/intel-client/types';
import { graphText } from './view';

export const captureRef = (id: string) => `capture:${id}`;

export function captureContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Queue the extract. Skipped (no job) when the text is under Core's floor —
 * the job would only come back `too-short`. The hash is of the full text, so a
 * re-analysis or a confirmed speaker changes it and Core re-extracts; an
 * unchanged capture is `unchanged` at Core for free.
 */
export async function queueCaptureExtract(c: Capture): Promise<{ queued: boolean; chars: number }> {
  const text = graphText(c);
  if (text.length < MIN_EXTRACT_CHARS) return { queued: false, chars: text.length };
  await enqueueIntelJob('extract', captureRef(c.id), {
    kind: 'capture',
    source: 'capture',
    refId: c.id,
    spaceId: c.spaceId,
    title: (c.title || 'Capture').slice(0, 200),
    text,
    contentHash: captureContentHash(text),
    observedAt: c.startedAt.toISOString(),
    metadata: { captureId: c.id, sourceUrl: `/captures/${c.id}` },
  });
  return { queued: true, chars: text.length };
}
