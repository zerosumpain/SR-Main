/**
 * Provider-grounded web lookup for blog tools.
 *
 * Blog source discovery used to call Tavily directly, once per claim and at
 * advanced depth. A single review could therefore consume two credits for
 * every factual sentence in a draft. Blog tooling is an editorial aid, not a
 * deep-research run, so it belongs on the same bounded web-grounding route as
 * Instant research instead.
 */
import { groundedCompletion } from '$lib/deepdive/ai';
import { groundedRoute } from '$lib/deepdive/grounding';
import { resolveResearchFastModel } from '$lib/server/models/workload-settings';

export interface GroundedWebResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

const SOURCE_SYSTEM = `You are finding sources for a blog editor.

Search the live web before answering. Prefer primary, official, academic and
reputable editorial sources. Briefly explain what the strongest sources say
about the query. Cite only pages you actually retrieved; never invent a URL.`;

/**
 * Run the research-fast model through Instant research's grounded route and
 * expose its real citation annotations in the result shape the blog panels
 * already consume.
 */
export async function groundedSourceSearch(query: string, subject?: string): Promise<GroundedWebResult[]> {
  const model = (await resolveResearchFastModel()).modelId;
  const mode = groundedRoute('fast', model);
  const prompt = subject
    ? `Find evidence relevant to this claim:\n\nCLAIM: ${subject}\n\nSEARCH QUERY: ${query}`
    : `Find reliable sources for this search query:\n\n${query}`;

  const { text, citations } = await groundedCompletion(SOURCE_SYSTEM, prompt, {
    mode,
    model,
    maxTokens: 1_200,
  });

  const seen = new Set<string>();
  const unique = citations.filter((citation) => {
    if (seen.has(citation.url)) return false;
    seen.add(citation.url);
    return true;
  });

  return unique.map((citation, index) => ({
    url: citation.url,
    title: citation.title?.trim() || new URL(citation.url).hostname,
    // Grounded providers return citation metadata rather than Tavily-style
    // per-result snippets. The answer is still useful ranking context and is
    // preferable to fabricating text that was never returned for this page.
    content: text,
    score: Math.max(0, 1 - index * 0.05),
  }));
}
