import { db } from '$lib/db';
import { sources, facts } from '$lib/db/schema';
import { eq, and, sql, ne } from 'drizzle-orm';
import { jsonCompletion } from './ai';
import { toVectorLiteral } from './vector';
import { hasOpenRouter } from '$lib/llm/keys';

// Static domain classification maps
const TLD_SCORES: Record<string, { score: number; type: string }> = {
  '.gov': { score: 0.9, type: 'government' },
  '.gov.uk': { score: 0.9, type: 'government' },
  '.gov.au': { score: 0.9, type: 'government' },
  '.edu': { score: 0.85, type: 'academic' },
  '.ac.uk': { score: 0.85, type: 'academic' },
  '.edu.au': { score: 0.85, type: 'academic' },
};

const DOMAIN_SCORES: Record<string, { score: number; type: string }> = {
  // Major news
  'reuters.com': { score: 0.85, type: 'major_news' },
  'apnews.com': { score: 0.85, type: 'major_news' },
  'bbc.co.uk': { score: 0.8, type: 'major_news' },
  'bbc.com': { score: 0.8, type: 'major_news' },
  'nytimes.com': { score: 0.8, type: 'major_news' },
  'theguardian.com': { score: 0.75, type: 'major_news' },
  'washingtonpost.com': { score: 0.75, type: 'major_news' },
  'ft.com': { score: 0.8, type: 'major_news' },
  'economist.com': { score: 0.8, type: 'major_news' },
  'bloomberg.com': { score: 0.8, type: 'major_news' },
  'aljazeera.com': { score: 0.75, type: 'major_news' },

  // Academic publishers
  'nature.com': { score: 0.9, type: 'academic' },
  'science.org': { score: 0.9, type: 'academic' },
  'sciencedirect.com': { score: 0.85, type: 'academic' },
  'springer.com': { score: 0.85, type: 'academic' },
  'pubmed.ncbi.nlm.nih.gov': { score: 0.9, type: 'academic' },
  'scholar.google.com': { score: 0.8, type: 'academic' },
  'arxiv.org': { score: 0.8, type: 'academic' },
  'jstor.org': { score: 0.85, type: 'academic' },
  'researchgate.net': { score: 0.7, type: 'academic' },

  // Wiki
  'en.wikipedia.org': { score: 0.6, type: 'wiki' },
  'wikipedia.org': { score: 0.6, type: 'wiki' },

  // Social media
  'twitter.com': { score: 0.3, type: 'social' },
  'x.com': { score: 0.3, type: 'social' },
  'reddit.com': { score: 0.35, type: 'social' },
  'facebook.com': { score: 0.25, type: 'social' },
  'instagram.com': { score: 0.25, type: 'social' },
  'tiktok.com': { score: 0.2, type: 'social' },
  'youtube.com': { score: 0.4, type: 'social' },
  'linkedin.com': { score: 0.5, type: 'social' },

  // Blogs / content platforms
  'medium.com': { score: 0.4, type: 'blog' },
  'substack.com': { score: 0.45, type: 'blog' },
  'wordpress.com': { score: 0.35, type: 'blog' },
  'blogspot.com': { score: 0.3, type: 'blog' },
};

export function classifyDomain(domain: string): { score: number; type: string } {
  const lower = domain.toLowerCase();

  // Check exact domain match first
  if (DOMAIN_SCORES[lower]) return DOMAIN_SCORES[lower];

  // Check parent domains (e.g. news.bbc.co.uk → bbc.co.uk)
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(i).join('.');
    if (DOMAIN_SCORES[parent]) return DOMAIN_SCORES[parent];
  }

  // Check TLD patterns
  for (const [tld, result] of Object.entries(TLD_SCORES)) {
    if (lower.endsWith(tld)) return result;
  }

  // Default: moderate score, classify as 'other'
  // News-like domains get a slight bump
  if (lower.includes('news') || lower.includes('journal') || lower.includes('times') || lower.includes('post')) {
    return { score: 0.55, type: 'news' };
  }

  return { score: 0.5, type: 'other' };
}

export async function classifyDomainWithFallback(
  domain: string,
  systemPrompt: string,
): Promise<{ score: number; type: string }> {
  const staticResult = classifyDomain(domain);
  // Only use LLM fallback for 'other' type (unknown domains)
  if (staticResult.type !== 'other') return staticResult;

  try {
    const result = await jsonCompletion<{ score: number; type: string }>(
      systemPrompt,
      `Classify this domain for source credibility. Domain: "${domain}"
Return a credibility score (0.0-1.0) and type.
Types: academic, government, major_news, news, blog, social, wiki, other
Score guide: 0.9+ = highly authoritative, 0.7-0.9 = reliable, 0.5-0.7 = moderate, <0.5 = low reliability
Respond with JSON: { "score": 0.X, "type": "..." }`,
      { temperature: 0.1, maxTokens: 256 },
    );
    return {
      score: Math.max(0, Math.min(1, result.score ?? 0.5)),
      type: result.type || 'other',
    };
  } catch {
    return staticResult;
  }
}

export async function computeSourceAgreement(sessionId: string): Promise<void> {
  const embeddingsAvailable = await hasOpenRouter();

  if (embeddingsAvailable) {
    // Embedding-based: for each fact with an embedding, count distinct sources
    // where another fact (from a different source) has cosine similarity > 0.85
    const allFacts = await db
      .select({ id: facts.id, sourceId: facts.sourceId, embedding: facts.embedding })
      .from(facts)
      .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

    const factsWithEmbeddings = allFacts.filter((f) => f.embedding);

    for (const fact of factsWithEmbeddings) {
      if (!fact.embedding) continue;
      const vectorStr = toVectorLiteral(fact.embedding);

      const similar = await db.execute(
        sql`SELECT DISTINCT f.source_id FROM fact f
            WHERE f.session_id = ${sessionId}
              AND f.id != ${fact.id}
              AND f.source_id != ${fact.sourceId}
              AND NOT f.is_counterfactual
              AND f.embedding IS NOT NULL
              AND 1 - (f.embedding <=> ${vectorStr}::vector) > 0.85
            LIMIT 10`,
      );

      const agreement = similar.rows.length;
      if (agreement > 0) {
        await db.update(facts).set({ sourceAgreement: agreement }).where(eq(facts.id, fact.id));
      }
    }
  } else {
    // Fallback: simple count of facts with very similar content from different sources
    // (less accurate but works without embeddings)
    const allFacts = await db
      .select({ id: facts.id, sourceId: facts.sourceId, content: facts.content })
      .from(facts)
      .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

    for (const fact of allFacts) {
      // Count facts from other sources that share significant word overlap
      const words = new Set(fact.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
      let agreement = 0;
      const seenSources = new Set<string>();

      for (const other of allFacts) {
        if (other.id === fact.id || other.sourceId === fact.sourceId) continue;
        if (seenSources.has(other.sourceId)) continue;

        const otherWords = other.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        let overlap = 0;
        for (const w of otherWords) {
          if (words.has(w)) overlap++;
        }
        const ratio = words.size > 0 ? overlap / words.size : 0;
        if (ratio > 0.5) {
          agreement++;
          seenSources.add(other.sourceId);
        }
      }

      if (agreement > 0) {
        await db.update(facts).set({ sourceAgreement: agreement }).where(eq(facts.id, fact.id));
      }
    }
  }
}
