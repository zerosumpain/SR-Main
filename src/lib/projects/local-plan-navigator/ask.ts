// Pure pieces of the Local Plan Navigator's "describe a problem" endpoint —
// kept apart from the request handler so they can be unit-tested without a
// server. The endpoint itself is src/routes/api/projects/local-plan-navigator/ask.

/** A passage of the navigator's corpus, as the bundle's build writes it to data/corpus.json. */
export interface NavigatorChunk {
  id: string;
  doc: string;
  docTitle: string;
  kind: string;
  anchor: string;
  route: string;
  heading: string;
  text: string;
}

export const MAX_QUESTION_CHARS = 600;
export const MAX_PASSAGES = 6;
export const MAX_PASSAGE_CHARS = 1500;

/**
 * What the page sends: its question and the ids of the passages its own
 * search found. Only the ids are trusted — the text comes from the server's
 * copy of the corpus, so nothing a visitor types can become "guidance" in the
 * prompt.
 */
export function parseAskBody(body: unknown): { question: string; ids: string[] } {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const question = String(value.question ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS);
  const raw = Array.isArray(value.ids) ? value.ids : [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || id.length > 160 || !/^[a-z0-9-]+#[A-Za-z0-9._:-]+$/.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_PASSAGES) break;
  }
  return { question, ids };
}

/** The chunks for the ids the page sent, in the page's order, unknown ids dropped. */
export function pickChunks(ids: string[], byId: Map<string, NavigatorChunk>): NavigatorChunk[] {
  return ids.map((id) => byId.get(id)).filter((c): c is NavigatorChunk => !!c);
}

/** The shape the shared project-chat handler wants, with the site URL of each passage. */
export function toChatChunks(chunks: NavigatorChunk[], siteOrigin = 'https://strangeramblings.com') {
  return chunks.map((c) => ({
    title: `${c.docTitle} — ${c.heading}`,
    text: c.text.slice(0, MAX_PASSAGE_CHARS),
    url: `${siteOrigin}/projects/local-plan-navigator${c.route}#${c.anchor}`,
    sourceType: c.kind,
  }));
}

export const SYSTEM_PROMPT = `You help officers in English local planning authorities understand the local plan-making system: the 30-month process, the three gateways, the Town and Country Planning (Local Planning) (England) Regulations 2026, the Environmental Assessment of Plans and Programmes Regulations 2004, the National Planning Policy Framework (August 2026) and the government's guidance. You answer for a prototype at strangeramblings.com/projects/local-plan-navigator, which is not a government service.

RULES:
1. Answer ONLY from the numbered context passages. If they do not answer the question, say so plainly and say what they do cover. Never draw on outside knowledge for a fact, a regulation number, a duration or a date.
2. Cite the passage each statement comes from inline, like [1] or [2][3].
3. Plain British English, short sentences, at most 180 words. No headings, no bullet lists, no preamble.
4. This is not legal advice; say so in one short sentence only if the question asks what an authority is legally allowed to do.
5. If the question is off-topic — anything other than local plan-making in England — decline in one sentence and say what you can help with.`;
