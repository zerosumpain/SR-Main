import { db } from '$lib/db';
import { sources, researchLeads } from '$lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
import type { ResearchSession } from '$lib/db/schema';
import { jsonCompletion } from './ai';
import { search } from './tavily';
import { emitLog, emitStats, shouldStop, getAbortSignal, throwIfStopped } from './worker';
import { addLeads, takeLeads, recordLeadSources, MAX_LEAD_DEPTH } from './frontier';
import { emitArtefact } from './desk-events';
import { classifyDomain } from './credibility';
import { DIVERSITY_THRESHOLDS } from './types';
import type { SessionConfig, SessionStats, SeedContext } from './types';

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

  const seedContext = session.seedContext as SeedContext | null;
  let systemPrompt = `You are a research assistant. The research topic is: "${session.topic}"\nResearch goals: ${goals.join('; ')}`;

  if (seedContext) {
    systemPrompt += `\n\nThis is a follow-up investigation from a parent research session on "${seedContext.parentTopic}".`;
    if (seedContext.factContents?.length) {
      systemPrompt += `\nKey facts from parent research:\n${seedContext.factContents.slice(0, 5).map((f) => `- ${f}`).join('\n')}`;
    }
    if (seedContext.entityNames?.length) {
      systemPrompt += `\nKey entities: ${seedContext.entityNames.join(', ')}`;
    }
    if (seedContext.clusterSummary) {
      systemPrompt += `\nParent cluster context: ${seedContext.clusterSummary}`;
    }
    if (seedContext.gapDescription) {
      systemPrompt += `\nKnowledge gap being investigated: ${seedContext.gapDescription}`;
    }
    if (seedContext.hypothesisText) {
      systemPrompt += `\nHypothesis being tested: ${seedContext.hypothesisText}`;
    }
  }

  /**
   * Step 1: seed the frontier — but only on a run that has no frontier yet.
   *
   * `addLeads` already discards duplicate queries, so re-seeding a resumed run
   * changed nothing and still cost a model call every time. A session that
   * already has leads has been here before.
   */
  const [leadCount] = await db
    .select({ n: count() })
    .from(researchLeads)
    .where(eq(researchLeads.sessionId, sessionId));

  if (Number(leadCount?.n ?? 0) === 0) {
    emitLog(sessionId, '\u{1F50D}', 'Generating initial search queries...');

    let queryPrompt = `Generate 8-12 diverse search queries covering different angles of this topic. Include biographical, technical, historical, critical, contextual, geographical, legal, and economic angles as relevant. Vary the phrasing to minimize result overlap.`;
    if (seedContext?.suggestedQueries?.length) {
      queryPrompt += `\n\nSuggested starting queries from prior research (use as inspiration but also generate fresh angles):\n${seedContext.suggestedQueries.map((q) => `- ${q}`).join('\n')}`;
    }
    queryPrompt += `\n\nRespond with JSON: { "queries": ["query1", "query2", ...] }`;

    const queryResult = await jsonCompletion<{ queries: string[] }>(
      systemPrompt,
      queryPrompt,
    );

    const seedQueries = queryResult.queries ?? [];
    if (seedQueries.length === 0) return;

    // The frontier replaces the old in-memory `followUpQueue`: a plain FIFO with
    // no scores, which spawned children from an unproductive query exactly as
    // eagerly as from a productive one, and evaporated on restart.
    await addLeads(
      sessionId,
      seedQueries.map((q) => ({ query: q, origin: 'seed' as const, depth: 0 })),
    );
  } else {
    emitLog(sessionId, 'ℹ️', `Picking the frontier back up — ${leadCount?.n} leads already generated.`);
  }

  const seenUrls = new Set<string>();
  const allCategories = new Set<string>();
  let consecutiveLowDiversity = 0;
  /**
   * Sources this SESSION has, not sources this call has gathered.
   *
   * The counter used to start at zero on every entry, and `maxSources` is the
   * only thing bounding the loop — so each resume gathered a further full
   * allowance. A production investigation that was re-adopted on a dozen
   * deploys had accumulated 113 sources against a cap of 40, all of it paid
   * for. Reading the stored count makes the cap mean what it says.
   */
  const [stored] = await db
    .select({ n: count() })
    .from(sources)
    .where(eq(sources.sessionId, sessionId));
  let totalSourcesStored = Number(stored?.n ?? 0);

  const stats: SessionStats = {
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  };

  // Process leads in batches, highest expected value first.
  while (totalSourcesStored < maxSources && !isTimeUp()) {
    const batch = await takeLeads(sessionId, 3);
    if (batch.length === 0) break;

    const batchNewCategories = new Set<string>();
    let batchSourceCount = 0;

    for (const lead of batch) {
      const query = lead.query;
      if (totalSourcesStored >= maxSources || isTimeUp()) break;

      emitLog(sessionId, '\u{1F50D}', `Searching: "${query}"`);
      let leadSources = 0;
      let leadSearchFailed = false;
      const followUps: string[] = [];

      try {
        const results = await search(query, { maxResults: 10 });

        for (const result of results.results) {
          if (seenUrls.has(result.url)) continue;
          if (totalSourcesStored >= maxSources) break;
          seenUrls.add(result.url);

          const domain = getDomain(result.url);
          const credibility = classifyDomain(domain);

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
              credibilityScore: credibility.score,
              credibilityType: credibility.type,
              leadId: lead.id,
            })
            .returning();

          // Desk: drop the source card onto the canvas (id is now stable).
          // category resolves later via the follow-up LLM update; null at first paint.
          emitArtefact(sessionId, 'source', 1, {
            id: stored.id,
            url: stored.url,
            title: stored.title,
            domain: stored.domain,
            category: stored.category ?? null,
            credibilityScore: stored.credibilityScore,
            credibilityType: stored.credibilityType,
          });

          totalSourcesStored++;
          batchSourceCount++;
          leadSources++;
          stats.sourcesFound = totalSourcesStored;

          emitLog(sessionId, '\u{1F4C4}', `Source: ${result.title?.slice(0, 60) ?? result.url}`);
          throwIfStopped(sessionId);

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

            if (analysis.follow_up_queries?.length && lead.depth < MAX_LEAD_DEPTH) {
              followUps.push(...analysis.follow_up_queries);
            }
          } catch (err) {
            console.error('[deepdive] Source analysis failed:', err);
          }
        }
      } catch (err) {
        console.error('[deepdive] Search failed:', err);
        emitLog(sessionId, '\u2139\uFE0F', `Search failed for: "${query}"`);
        leadSearchFailed = true;
      }

      // Phase 1 only gathers; facts and entities arrive in phase 2, so the
      // lead cannot be judged yet. Park it as `running` with what we know and
      // let phase 2 close it out against the material it actually produced.
      await recordLeadSources(sessionId, lead.id, leadSources, leadSearchFailed);

      if (followUps.length) {
        await addLeads(
          sessionId,
          followUps.splice(0, 3).map((q) => ({
            query: q,
            parentId: lead.id,
            depth: lead.depth + 1,
            origin: 'followup' as const,
            originDetail: lead.query,
          })),
        );
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

  }

  emitLog(sessionId, '\u2139\uFE0F', `Phase 1 complete: ${totalSourcesStored} sources, ${allCategories.size} categories`);
  emitStats(sessionId, stats);
}
