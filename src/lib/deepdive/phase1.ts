import { db } from '$lib/db';
import { sources } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { ResearchSession } from '$lib/db/schema';
import { jsonCompletion } from './ai';
import { search } from './tavily';
import { emitLog, emitStats, shouldStop } from './worker';
import { DIVERSITY_THRESHOLDS } from './types';
import type { SessionConfig, SessionStats } from './types';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function runPhase1(
  sessionId: string,
  session: ResearchSession,
  isTimeUp: () => boolean,
): Promise<void> {
  const config = (session.config ?? {}) as SessionConfig;
  const maxSources = config.maxSources ?? 40;
  const threshold = DIVERSITY_THRESHOLDS[config.diversityThreshold ?? 'medium'];
  const goals = (session.goals ?? []) as string[];

  const systemPrompt = `You are a research assistant. The research topic is: "${session.topic}"\nResearch goals: ${goals.join('; ')}`;

  // Step 1: Generate initial search queries
  emitLog(sessionId, '\u{1F50D}', 'Generating initial search queries...');

  const queryResult = await jsonCompletion<{ queries: string[] }>(
    systemPrompt,
    `Generate 8-12 diverse search queries covering different angles of this topic. Include biographical, technical, historical, critical, contextual, geographical, legal, and economic angles as relevant. Vary the phrasing to minimize result overlap.\n\nRespond with JSON: { "queries": ["query1", "query2", ...] }`,
  );

  let queries = queryResult.queries ?? [];
  if (queries.length === 0) return;

  const seenUrls = new Set<string>();
  const allCategories = new Set<string>();
  let consecutiveLowDiversity = 0;
  let totalSourcesStored = 0;

  const stats: SessionStats = {
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  };

  const followUpQueue: string[] = [];

  // Process queries in batches
  while (queries.length > 0 && totalSourcesStored < maxSources && !isTimeUp()) {
    const batch = queries.splice(0, 3);

    const batchNewCategories = new Set<string>();
    let batchSourceCount = 0;

    for (const query of batch) {
      if (totalSourcesStored >= maxSources || isTimeUp()) break;

      emitLog(sessionId, '\u{1F50D}', `Searching: "${query}"`);

      try {
        const results = await search(query, { maxResults: 10 });

        for (const result of results.results) {
          if (seenUrls.has(result.url)) continue;
          if (totalSourcesStored >= maxSources) break;
          seenUrls.add(result.url);

          const domain = getDomain(result.url);

          // Store source
          const [stored] = await db
            .insert(sources)
            .values({
              sessionId,
              url: result.url,
              title: result.title,
              snippet: result.content?.slice(0, 500),
              domain,
              phase: 1,
            })
            .returning();

          totalSourcesStored++;
          batchSourceCount++;
          stats.sourcesFound = totalSourcesStored;

          emitLog(sessionId, '\u{1F4C4}', `Source: ${result.title?.slice(0, 60) ?? result.url}`);

          // Categorise source and get follow-up queries
          try {
            const analysis = await jsonCompletion<{
              category: string;
              preview_facts: string[];
              follow_up_queries: string[];
            }>(
              systemPrompt,
              `Analyse this search result snippet and return JSON:\n- category: a short phrase describing what angle this source covers\n- preview_facts: 3-5 bullet-point preview facts\n- follow_up_queries: 2-3 suggested follow-up search queries\n\nTitle: ${result.title}\nSnippet: ${result.content?.slice(0, 800)}\n\nRespond with JSON: { "category": "...", "preview_facts": [...], "follow_up_queries": [...] }`,
            );

            if (analysis.category) {
              await db
                .update(sources)
                .set({ category: analysis.category })
                .where(eq(sources.id, stored.id));

              if (!allCategories.has(analysis.category)) {
                batchNewCategories.add(analysis.category);
                allCategories.add(analysis.category);
                emitLog(sessionId, '\u{1F50D}', `New category: ${analysis.category}`);
              }
            }

            if (analysis.follow_up_queries) {
              followUpQueue.push(...analysis.follow_up_queries);
            }
          } catch (err) {
            console.error('[deepdive] Source analysis failed:', err);
          }
        }
      } catch (err) {
        console.error('[deepdive] Search failed:', err);
        emitLog(sessionId, '\u2139\uFE0F', `Search failed for: "${query}"`);
      }
    }

    emitStats(sessionId, stats);

    // Diversity check
    if (batchSourceCount > 0) {
      const newCategoryFraction = batchNewCategories.size / batchSourceCount;
      if (newCategoryFraction < threshold) {
        consecutiveLowDiversity++;
        if (consecutiveLowDiversity >= 3) {
          emitLog(sessionId, '\u2139\uFE0F', `Diversity saturation reached (${allCategories.size} categories). Ending Phase 1.`);
          break;
        }
      } else {
        consecutiveLowDiversity = 0;
      }
    }

    // Refill queries from follow-up queue
    if (queries.length === 0 && followUpQueue.length > 0) {
      queries = followUpQueue.splice(0, 6);
    }
  }

  emitLog(sessionId, '\u2139\uFE0F', `Phase 1 complete: ${totalSourcesStored} sources, ${allCategories.size} categories`);
  emitStats(sessionId, stats);
}
