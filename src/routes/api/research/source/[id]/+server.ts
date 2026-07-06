// Read-only reconstruction of a research source's page material for the in-app
// rich reader modal (see ResearchSourceModal). The deep-research worker stores the
// fetched page content only as embedded, overlapping `source_chunk` rows — there is
// no persisted full-text column — so we reassemble it here (ordered by chunkOrd,
// de-overlapped) and return it with the source's title/url/domain + session topic.
//
// Owner-gated by default: the whole authed area (incl. /api/*) is owner-only at the
// hooks layer, and this route is on no public/guest allow-list. Research is private.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sources, sourceChunks, researchSessions } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { OVERLAP_CHARS } from '$lib/rag/types';

// Bound the reassembled payload — sources are already capped at index time, but a
// belt-and-braces cap keeps the response small and the {@html} render snappy.
const MAX_RECONSTRUCTED_CHARS = 200_000;

/**
 * Reassemble ordered, overlapping chunks into one document. Consecutive chunks
 * share ~OVERLAP_CHARS of original text (trimmed at their own edges, so the shared
 * region is internal and intact); append only each chunk's non-overlapping tail.
 */
function reassemble(chunks: Array<{ text: string }>): string {
  let full = '';
  for (const c of chunks) {
    const t = c.text ?? '';
    if (!t) continue;
    if (!full) {
      full = t;
      continue;
    }
    const maxOverlap = Math.min(full.length, t.length, OVERLAP_CHARS * 2);
    let ov = 0;
    for (let k = maxOverlap; k > 0; k--) {
      if (full.slice(full.length - k) === t.slice(0, k)) {
        ov = k;
        break;
      }
    }
    // No detectable overlap → a real gap between chunks; join with a blank line.
    full += ov > 0 ? t.slice(ov) : `\n\n${t}`;
    if (full.length > MAX_RECONSTRUCTED_CHARS) {
      full = full.slice(0, MAX_RECONSTRUCTED_CHARS);
      break;
    }
  }
  return full;
}

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });

  const [src] = await db
    .select({
      id: sources.id,
      url: sources.url,
      title: sources.title,
      domain: sources.domain,
      snippet: sources.snippet,
      sessionId: sources.sessionId,
      sessionTopic: researchSessions.topic,
    })
    .from(sources)
    .leftJoin(researchSessions, eq(researchSessions.id, sources.sessionId))
    .where(eq(sources.id, id));

  if (!src) return json({ error: 'source not found' }, { status: 404 });

  const chunks = await db
    .select({ text: sourceChunks.text })
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, id))
    .orderBy(asc(sourceChunks.chunkOrd));

  const text = reassemble(chunks);

  return json({
    id: src.id,
    url: src.url,
    title: src.title,
    domain: src.domain,
    sessionId: src.sessionId,
    sessionTopic: src.sessionTopic ?? '',
    // Fall back to the stored snippet when a source was never chunked (e.g. thin
    // fetch) so the modal still has something to render.
    text: text || src.snippet || '',
    chunkCount: chunks.length,
  });
};
