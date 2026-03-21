import { db } from '$lib/db';
import { facts, sources, researchSessions } from '$lib/db/schema';
import type { ResearchSession, Fact } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jsonCompletion } from './ai';
import { search } from './tavily';
import { emitLog, emitStats, shouldStop } from './worker';
import type { SessionConfig, SessionStats, RedTeamReport } from './types';

export async function runPhase3(
  sessionId: string,
  session: ResearchSession,
  isTimeUp: () => boolean,
): Promise<void> {
  const config = (session.config ?? {}) as SessionConfig;
  const aggression = config.redTeamAggression ?? 'standard';
  const goals = (session.goals ?? []) as string[];

  const systemPrompt = `You are a critical research analyst performing adversarial fact-checking. Topic: "${session.topic}"\nGoals: ${goals.join('; ')}`;

  // Get all non-counterfactual facts
  const allFacts = await db
    .select()
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

  if (allFacts.length === 0) {
    emitLog(sessionId, '\u2139\uFE0F', 'No facts to challenge. Skipping Phase 3.');
    return;
  }

  // Count sources per fact
  const factSourceCounts = new Map<string, number>();
  for (const fact of allFacts) {
    factSourceCounts.set(fact.id, 1); // Each fact has at least its own source
  }

  // Score and rank facts
  const now = Date.now();
  const scored = allFacts.map((fact) => {
    const sourceCount = factSourceCounts.get(fact.id) ?? 1;
    const recencyBoost = fact.discoveredAt
      ? Math.max(0, 1 - (now - new Date(fact.discoveredAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
      : 0.5;
    const priority = fact.confidence * 0.4 + Math.min(sourceCount / 5, 1) * 0.3 + recencyBoost * 0.3;
    return { fact, priority };
  });

  scored.sort((a, b) => b.priority - a.priority);

  // Select facts to challenge based on aggression
  const totalFacts = allFacts.length;
  let maxChallenges: number;
  switch (aggression) {
    case 'gentle':
      maxChallenges = Math.min(30, Math.ceil(totalFacts * 0.2));
      break;
    case 'aggressive':
      maxChallenges = Math.min(150, Math.ceil(totalFacts * 0.6));
      break;
    default:
      maxChallenges = Math.min(75, Math.ceil(totalFacts * 0.4));
  }

  // Mix: top confidence + bottom confidence
  const topHalf = scored.slice(0, Math.ceil(maxChallenges * 0.6));
  const bottomHalf = scored.slice(-Math.ceil(maxChallenges * 0.4));
  const toChallenge = [...topHalf, ...bottomHalf].slice(0, maxChallenges);

  const report: RedTeamReport = {
    facts_challenged: 0,
    facts_refuted: 0,
    facts_nuanced: 0,
    facts_strengthened: 0,
    facts_unchanged: 0,
  };

  emitLog(sessionId, '\u{1F534}', `Challenging ${toChallenge.length} facts (${aggression} mode)`);

  // Get current stats
  const statsResult = await db.execute(
    sql`SELECT
      (SELECT count(*) FROM source WHERE session_id = ${sessionId}) as sources,
      (SELECT count(*) FROM fact WHERE session_id = ${sessionId} AND NOT is_counterfactual) as facts_count,
      (SELECT count(*) FROM entity WHERE session_id = ${sessionId}) as entities,
      (SELECT count(*) FROM fact WHERE session_id = ${sessionId} AND is_counterfactual) as counterfactuals`,
  );
  const row = statsResult.rows[0] as any;
  const stats: SessionStats = {
    sourcesFound: Number(row.sources),
    factsExtracted: Number(row.facts_count),
    entitiesIdentified: Number(row.entities),
    counterfactualsRaised: Number(row.counterfactuals),
  };

  for (const { fact } of toChallenge) {
    if (isTimeUp()) break;

    report.facts_challenged++;
    emitLog(sessionId, '\u{1F534}', `Challenging: "${fact.content.slice(0, 60)}..."`);

    try {
      // Generate adversarial queries (1-2 focused queries to conserve search credits)
      const queryResult = await jsonCompletion<{ queries: string[] }>(
        systemPrompt,
        `Generate 1-2 focused adversarial search queries designed to find counter-evidence or expert disagreement with this claim:\n\n"${fact.content}"\n\nRespond with JSON: { "queries": [...] }`,
      );

      let contradictions = 0;
      let supports = 0;

      // Collect existing source URLs for this session to avoid redundant searches
      const existingUrls = new Set(
        (await db.select({ url: sources.url }).from(sources).where(eq(sources.sessionId, sessionId)))
          .map((s) => s.url),
      );

      for (const query of (queryResult.queries ?? []).slice(0, 2)) {
        if (isTimeUp()) break;

        try {
          const results = await search(query, { maxResults: 3 });

          for (const result of results.results ?? []) {
            // Skip URLs we already have as sources
            if (existingUrls.has(result.url)) continue;
            existingUrls.add(result.url);

            // Evaluate the result
            const evaluation = await jsonCompletion<{
              verdict: 'supports' | 'contradicts' | 'qualifies' | 'irrelevant';
              counter_claim?: string;
              is_qualification?: boolean;
            }>(
              systemPrompt,
              `Given the original fact and this source content, classify the relationship:\n\nOriginal fact: "${fact.content}"\n\nSource title: ${result.title}\nSource content: ${result.content?.slice(0, 1500)}\n\nDoes this source:\n(a) support the fact\n(b) contradict it\n(c) qualify or nuance it\n(d) irrelevant\n\nRespond with JSON: { "verdict": "supports|contradicts|qualifies|irrelevant", "counter_claim": "the counter-claim if contradicts/qualifies", "is_qualification": true/false }`,
            );

            if (evaluation.verdict === 'contradicts' || evaluation.verdict === 'qualifies') {
              // Store source
              const [newSource] = await db
                .insert(sources)
                .values({
                  sessionId,
                  url: result.url,
                  title: result.title,
                  snippet: result.content?.slice(0, 500),
                  domain: new URL(result.url).hostname,
                  phase: 3,
                })
                .returning();

              // Store counterfactual
              await db.insert(facts).values({
                sessionId,
                sourceId: newSource.id,
                content: evaluation.counter_claim || `Counter to: ${fact.content.slice(0, 100)}`,
                confidence: evaluation.verdict === 'contradicts' ? 0.6 : 0.4,
                isCounterfactual: true,
                refutesFactId: fact.id,
                tags: ['counterfactual'],
              });

              contradictions++;
              stats.counterfactualsRaised++;

              if (evaluation.verdict === 'contradicts') {
                report.facts_refuted++;
                emitLog(sessionId, '\u26A0\uFE0F', `Counterfactual found for: "${fact.content.slice(0, 40)}..."`);
              } else {
                report.facts_nuanced++;
                emitLog(sessionId, '\u26A0\uFE0F', `Nuance found for: "${fact.content.slice(0, 40)}..."`);
              }
            } else if (evaluation.verdict === 'supports') {
              supports++;
            }
          }
        } catch (err) {
          console.error('[deepdive] Red team search failed:', err);
        }
      }

      // Adjust confidence
      let newConfidence = fact.confidence;
      if (contradictions > 0) {
        newConfidence = Math.max(0.05, newConfidence - 0.05 * contradictions);
      }
      if (supports > 0) {
        newConfidence = Math.min(0.97, newConfidence + 0.03 * supports);
      }

      if (newConfidence !== fact.confidence) {
        await db
          .update(facts)
          .set({ confidence: newConfidence })
          .where(eq(facts.id, fact.id));
      }

      if (contradictions === 0 && supports === 0) {
        report.facts_unchanged++;
      } else if (contradictions === 0) {
        report.facts_strengthened++;
      }
    } catch (err) {
      console.error('[deepdive] Red team challenge failed:', err);
      report.facts_unchanged++;
    }

    emitStats(sessionId, stats);
  }

  // Store red team report in session config
  const currentConfig = (session.config ?? {}) as Record<string, unknown>;
  currentConfig.red_team_report = report;
  await db
    .update(researchSessions)
    .set({ config: currentConfig })
    .where(eq(researchSessions.id, sessionId));

  emitLog(
    sessionId,
    '\u2139\uFE0F',
    `Phase 3 complete: ${report.facts_challenged} challenged, ${report.facts_refuted} refuted, ${report.facts_nuanced} nuanced, ${report.facts_strengthened} strengthened`,
  );
}
