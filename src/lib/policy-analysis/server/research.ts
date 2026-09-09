import { search, extract } from '$lib/deepdive/tavily';
import { classifyDomain } from '$lib/deepdive/credibility';
import { assertPublicUrl } from '$lib/server/ssrf-guard';
import { artefact, safeSourceUrl, type Artefact, type StageOutput } from '../contracts';

export type Research = (questions: Artefact[], signal: AbortSignal, maxResults?: number) => Promise<StageOutput>;
export const research: Research = async (questions, signal, maxResults = 3) => {
  const artefacts: Artefact[] = []; const warnings: string[] = [];
  for (const question of questions) {
    signal.throwIfAborted();
    const query = String(question.data.searchStrategy).slice(0, 350);
    try {
      if (/@|https?:|[\r\n]/.test(query)) throw new Error('unsafe query');
      const found = await search(query, { maxResults, searchDepth: 'advanced', signal });
      if (!Array.isArray(found.results) || !found.results.length) warnings.push(`No sources found for ${question.label}.`);
      for (const result of (found.results ?? []).slice(0, maxResults)) {
        if (typeof result.url !== 'string') continue;
        const url = safeSourceUrl(result.url);
        if (!url) continue;
        try { await assertPublicUrl(url); } catch { warnings.push('A non-public research source was rejected.'); continue; }
        let content = typeof result.content === 'string' ? result.content.slice(0, 10000) : '';
        let retrieval: 'full_text' | 'search_excerpt' = 'search_excerpt';
        try {
          const retrieved = await extract([url], signal);
          const body = retrieved.results.find((r) => r.url === url)?.raw_content;
          if (typeof body === 'string' && body.length > 100) { content = body.slice(0, 10000); retrieval = 'full_text'; }
        } catch { warnings.push(`Full text unavailable for ${new URL(url).hostname}; only its search excerpt is retained.`); }
        if (!content.trim()) continue;
        const quality = classifyDomain(new URL(url).hostname);
        artefacts.push(artefact(`source_${question.id}_${artefacts.length}`, 'research_source', String(result.title || new URL(url).hostname).slice(0, 300), content, {
          questionId: question.id, retrievedAt: new Date().toISOString(), quality: quality.type,
          qualityBasis: 'Existing site domain classification is a heuristic, not verification of this source’s claims.',
          freshness: 'Publication date not verified; retrieval date is recorded.', jurisdictionalRelevance: 'Requires evidence-matrix review.', retrieval,
          gap: retrieval === 'search_excerpt' ? 'Full text unavailable; conclusions must remain provisional.' : 'Extracted text may be incomplete; applicability requires review.',
        }, { origin: 'external_evidence', confidence: null, refs: [question.id], url }));
      }
    } catch {
      signal.throwIfAborted();
      warnings.push(`Research unavailable for ${question.label}. Authority, freshness and jurisdiction remain unverified.`);
    }
  }
  if (!artefacts.length) warnings.push('External research produced no usable sources. This assessment is based on the policy and explicitly labelled inferences only.');
  return { artefacts, warnings };
};
