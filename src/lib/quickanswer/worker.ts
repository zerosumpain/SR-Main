import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import type { QuickAnswerSource } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { jsonCompletion, streamCompletion } from '$lib/deepdive/ai';
import { search } from '$lib/deepdive/tavily';
import { classifyDomain } from '$lib/deepdive/credibility';
import type { QuickAnswerSSEEvent, QuickAnswerStatus } from './types';
import { systemPrompt, QUERY_GEN_PROMPT, synthesisSystemPrompt, synthesisUserPrompt } from './prompts';

const activeEmitters = new Map<string, EventEmitter>();
const abortControllers = new Map<string, AbortController>();

export function getEmitter(id: string): EventEmitter {
  let emitter = activeEmitters.get(id);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    activeEmitters.set(id, emitter);
  }
  return emitter;
}

function emit(id: string, event: QuickAnswerSSEEvent): void {
  const emitter = activeEmitters.get(id);
  if (emitter) {
    emitter.emit('event', event);
  }
}

async function updateStatus(id: string, status: QuickAnswerStatus): Promise<void> {
  await db.update(quickAnswers).set({ status }).where(eq(quickAnswers.id, id));
  emit(id, { type: 'status', data: { status } });
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function mergeAndRank(
  searchResults: PromiseSettledResult<Awaited<ReturnType<typeof search>>>[],
  max: number,
): QuickAnswerSource[] {
  const seen = new Set<string>();
  const all: { url: string; title: string; domain: string; snippet: string; score: number; credScore: number; credType: string }[] = [];

  for (const result of searchResults) {
    if (result.status !== 'fulfilled') continue;
    for (let i = 0; i < result.value.results.length; i++) {
      const r = result.value.results[i];
      if (seen.has(r.url)) continue;
      seen.add(r.url);

      const domain = getDomain(r.url);
      const cred = classifyDomain(domain);
      // Position-weighted score: earlier results score higher
      const positionWeight = 1 - (i / 10) * 0.3;
      all.push({
        url: r.url,
        title: r.title,
        domain,
        snippet: r.content?.slice(0, 400) ?? '',
        score: cred.score * positionWeight,
        credScore: cred.score,
        credType: cred.type,
      });
    }
  }

  all.sort((a, b) => b.score - a.score);

  return all.slice(0, max).map((s, i) => ({
    url: s.url,
    title: s.title,
    domain: s.domain,
    credibilityScore: s.credScore,
    credibilityType: s.credType,
    snippet: s.snippet,
    citationIndex: i + 1,
  }));
}

export function requestStop(id: string): void {
  const ac = abortControllers.get(id);
  if (ac) ac.abort();
}

export async function startQuickAnswer(id: string): Promise<void> {
  runQuickAnswer(id).catch((err) => {
    console.error(`[quickanswer] Failed for ${id}:`, err);
    emit(id, { type: 'error', message: err.message });
    db.update(quickAnswers)
      .set({ status: 'failed', errorMessage: err.message, completedAt: new Date() })
      .where(eq(quickAnswers.id, id))
      .catch(console.error);
  });
}

async function runQuickAnswer(id: string): Promise<void> {
  const ac = new AbortController();
  abortControllers.set(id, ac);
  const start = Date.now();

  try {
    const [row] = await db.select().from(quickAnswers).where(eq(quickAnswers.id, id));
    if (!row) throw new Error('Quick answer not found');

    const topic = row.topic;
    const goals = (row.goals ?? []) as string[];
    const sys = systemPrompt(topic, goals);

    // Step 1: Generate queries
    await updateStatus(id, 'searching');
    emit(id, { type: 'log', message: 'Generating search queries...' });

    const queryResult = await jsonCompletion<{ queries: string[] }>(
      sys,
      QUERY_GEN_PROMPT,
      { maxTokens: 500, signal: ac.signal },
    );

    const queries = queryResult.queries ?? [];
    if (queries.length === 0) throw new Error('No queries generated');

    await db.update(quickAnswers).set({ queries }).where(eq(quickAnswers.id, id));
    emit(id, { type: 'log', message: `Searching: ${queries.length} queries in parallel...` });

    // Step 2: Parallel search
    const results = await Promise.allSettled(
      queries.map((q) =>
        search(q, {
          maxResults: 5,
          searchDepth: 'basic',
          includeAnswer: true,
          signal: ac.signal,
        }),
      ),
    );

    const sources = mergeAndRank(results, 12);
    if (sources.length === 0) throw new Error('No search results found');

    await db.update(quickAnswers).set({ sources }).where(eq(quickAnswers.id, id));
    emit(id, { type: 'sources', data: { sources } });
    emit(id, { type: 'log', message: `Found ${sources.length} sources. Synthesising answer...` });

    // Step 3: Streaming synthesis
    await updateStatus(id, 'synthesising');

    const { text: answer, tokensUsed } = await streamCompletion(
      synthesisSystemPrompt(),
      synthesisUserPrompt(topic, goals, sources),
      {
        model: 'anthropic/claude-haiku-4-5',
        maxTokens: 2000,
        signal: ac.signal,
        onToken: (token) => emit(id, { type: 'token', data: { token } }),
      },
    );

    const durationMs = Date.now() - start;
    await db.update(quickAnswers).set({
      status: 'complete',
      answer,
      tokensUsed,
      durationMs,
      completedAt: new Date(),
    }).where(eq(quickAnswers.id, id));

    emit(id, { type: 'complete', data: { durationMs } });
    emit(id, { type: 'status', data: { status: 'complete' } });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const message = err?.name === 'AbortError' ? 'Cancelled' : (err.message ?? 'Unknown error');
    await db.update(quickAnswers).set({
      status: 'failed',
      errorMessage: message,
      durationMs,
      completedAt: new Date(),
    }).where(eq(quickAnswers.id, id));
    emit(id, { type: 'error', message });
  } finally {
    abortControllers.delete(id);
    setTimeout(() => {
      activeEmitters.delete(id);
    }, 30000);
  }
}
