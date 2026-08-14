/**
 * The two tiers below `brief`: `instant` and `scan`.
 *
 * `instant` answers from the model's own knowledge with no search at all. Its
 * honesty requirement is the whole point of the tier — an answer with no
 * sources must SAY it has no sources, including that the model's knowledge has
 * a cutoff and may be stale. A confident unsourced answer that looks like a
 * researched one is the failure mode worth designing against.
 *
 * `scan` is the old quick-answer path, ported onto `research_session` so every
 * tier writes to one table and one stream. Behaviour is unchanged in kind:
 * parallel searches, credibility-and-position ranking, one streamed synthesis.
 * What is new is that it honours a research scope and a wall-clock budget.
 */
import { db } from '$lib/db';
import { researchSessions, sources as sourcesTable } from '$lib/db/schema';
import type { ResearchSession } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { jsonCompletion, streamCompletion } from './ai';
import { search } from './tavily';
import { classifyDomain } from './credibility';
import { emit, emitLog, emitStats, throwIfStopped, beat } from './worker';
import { emitArtefact } from './desk-events';
import { coerceScope, scopeToSearchOptions, scopeAdmits, credibilityBonus, describeScope } from './scope';
import { depthPreset, SYNTHESIS_MAX_TOKENS } from './depth';
import type { ResearchBudget } from './budget';
import type { SessionStats, ResearchReport } from './types';

const SEARCH_CEILING_MS = 15_000;
const QUERY_GEN_CEILING_MS = 10_000;

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function writeSummary(sessionId: string, answer: string): Promise<void> {
  const report: ResearchReport = {
    ranked_facts: [],
    timeline: [],
    clusters: [],
    executive_summary: answer,
    entity_centrality: {},
  };
  await db.update(researchSessions).set({ report }).where(eq(researchSessions.id, sessionId));
  emit(sessionId, { type: 'synthesis', data: { executive_summary: answer } });

  // An empty answer is a failed run, not a quiet one. Without this, an
  // out-of-credit provider (402 on every call) produced sessions that reported
  // `complete` and contained nothing.
  if (!answer.trim()) {
    throw new Error('No answer produced — the model returned nothing.');
  }
}

function streamHandlers(sessionId: string) {
  return {
    onToken: (t: string) => emit(sessionId, { type: 'token', data: { token: t } }),
    onReasoning: (t: string) =>
      emit(sessionId, { type: 'reasoning', data: { token: t, stage: 'synthesis' } }),
  };
}

/** Model knowledge only. No search, no sources, and it says so. */
export async function runInstant(
  sessionId: string,
  session: ResearchSession,
  budget: ResearchBudget,
): Promise<void> {
  const preset = depthPreset('instant');
  const goals = (session.goals ?? []) as string[];

  emitLog(sessionId, '\u{1F4AC}', 'Answering from model knowledge — no sources consulted.');

  const { text } = await streamCompletion(
    `You are answering from your own knowledge. No search has been run and you have no sources.\n\nRules:\n- Answer directly and usefully\n- You MUST open with a one-line note that this is unsourced, from training data, and may be out of date\n- Flag specifically anything likely to have changed recently, or that you are unsure of\n- Never invent citations, URLs, statistics presented as current, or figures you do not actually know\n- Say "I don't know" where that is the truthful answer`,
    `**Question:** ${session.topic}` + (goals.length ? `\n**Goals:** ${goals.join('; ')}` : ''),
    {
      model: preset.pinnedModel ?? undefined,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      signal: budget.signalFor('synthesis'),
      ...streamHandlers(sessionId),
    },
  );

  await writeSummary(sessionId, text);
  emitStats(sessionId, {
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  });
}

/** One round of search, cited, synthesised in a single streamed pass. */
export async function runScan(
  sessionId: string,
  session: ResearchSession,
  budget: ResearchBudget,
): Promise<void> {
  const preset = depthPreset('scan');
  const model = preset.pinnedModel ?? undefined;
  const scope = coerceScope(session.scope);
  const goals = (session.goals ?? []) as string[];
  const topic = session.topic;
  const sys =
    `You are a research assistant. The topic is: "${topic}"` +
    (goals.length ? `\nResearch goals: ${goals.join('; ')}` : '');

  emitLog(sessionId, '\u{1F50D}', `Scan: ${describeScope(scope)}`);

  const searchOpts = scopeToSearchOptions(scope);
  // Raw-topic search goes out first and runs while the model writes queries.
  const rawSearch = search(topic, {
    maxResults: 5,
    searchDepth: 'basic',
    ...searchOpts,
    signal: budget.signalFor('gather', SEARCH_CEILING_MS),
  }).catch(() => null);

  let queries: string[] = [];
  try {
    const gen = await jsonCompletion<{ queries: string[] }>(
      sys,
      `Generate 3-5 diverse search queries to cover different angles of this topic. Vary phrasing to minimise result overlap.\n\nRespond with JSON: { "queries": ["query1", ...] }`,
      { model, maxTokens: 1024, signal: budget.signalFor('gather', QUERY_GEN_CEILING_MS) },
    );
    queries = (gen.queries ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 5);
  } catch {
    emitLog(sessionId, 'ℹ️', 'Query generation unavailable — searching the topic directly.');
  }
  beat(sessionId);

  const settled = await Promise.allSettled(
    queries.map((q) =>
      search(q, {
        maxResults: 5,
        searchDepth: 'basic',
        ...searchOpts,
        signal: budget.signalFor('gather', SEARCH_CEILING_MS),
      }),
    ),
  );
  const raw = await rawSearch;
  throwIfStopped(sessionId);
  beat(sessionId);

  const seen = new Set<string>();
  const ranked: {
    url: string;
    title: string;
    domain: string;
    snippet: string;
    credibilityScore: number;
    credibilityType: string;
    rank: number;
  }[] = [];

  for (const res of [
    ...settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    ...(raw ? [raw] : []),
  ]) {
    for (let i = 0; i < (res.results?.length ?? 0); i++) {
      const r = res.results[i];
      if (!r?.url || seen.has(r.url)) continue;
      if (!scopeAdmits(scope, r.url)) continue;
      seen.add(r.url);
      const domain = getDomain(r.url);
      const cred = classifyDomain(domain);
      ranked.push({
        url: r.url,
        title: r.title ?? r.url,
        domain,
        snippet: (r.content ?? '').slice(0, 400),
        credibilityScore: cred.score,
        credibilityType: cred.type,
        rank: cred.score * (1 - (i / 10) * 0.3) + credibilityBonus(scope, r.url),
      });
    }
  }
  ranked.sort((a, b) => b.rank - a.rank);
  const chosen = ranked.slice(0, preset.maxSources);

  if (chosen.length === 0) {
    throw new Error(
      scope.mode === 'exclusive'
        ? `No sources matched your scope (${scope.includeDomains.join(', ')}). Widen the scope or remove the domain restriction.`
        : 'No search results found for this topic.',
    );
  }

  const stored = [];
  for (const s of chosen) {
    const [row] = await db
      .insert(sourcesTable)
      .values({
        sessionId,
        url: s.url,
        title: s.title,
        snippet: s.snippet,
        domain: s.domain,
        phase: 1,
        credibilityScore: s.credibilityScore,
        credibilityType: s.credibilityType,
      })
      .returning();
    stored.push(row);
    emitArtefact(sessionId, 'source', 1, {
      id: row.id,
      url: row.url,
      title: row.title,
      domain: row.domain,
      category: null,
      credibilityScore: row.credibilityScore,
      credibilityType: row.credibilityType,
    });
  }

  const stats: SessionStats = {
    sourcesFound: stored.length,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  };
  emitStats(sessionId, stats);
  emit(sessionId, {
    type: 'sources',
    data: {
      sources: stored.map((s, i) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        domain: s.domain,
        credibilityScore: s.credibilityScore,
        credibilityType: s.credibilityType,
        citationIndex: i + 1,
      })),
    },
  });
  emitLog(sessionId, '\u{1F4C4}', `${stored.length} sources. Synthesising…`);
  beat(sessionId);

  const citations = stored
    .map((s, i) => `[${i + 1}] ${s.title} (${s.domain})\n${s.snippet ?? ''}`)
    .join('\n\n');

  const { text } = await streamCompletion(
    `You are a research analyst who writes clear, factual, well-sourced answers.\n\nRules:\n- 200-500 words of clear prose\n- inline [N] citations referencing the numbered source list\n- cite at least three different sources\n- note where sources disagree\n- never assert anything the sources do not support\n- markdown formatting where it helps`,
    `**Topic:** ${topic}` +
      (goals.length ? `\n**Goals:** ${goals.join('; ')}` : '') +
      `\n\n**Sources:**\n${citations}\n\nWrite a synthesised answer with inline [N] citations.`,
    {
      model,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      signal: budget.signalFor('synthesis'),
      ...streamHandlers(sessionId),
    },
  );

  await writeSummary(sessionId, text);
}
