import { db } from '$lib/db';
import { facts, synthesisRuns } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ensureEmitter, emit } from './worker';
import { nextSeq } from './desk-events';
import { streamCompletion, jsonCompletion } from './ai';
import { buildScopePlan, resolveFactSet, type SynthesisScope } from './synthesis-scope';
import {
  registerSynthesisRun,
  getSynthesisSignal,
  isSynthesisAborted,
  clearSynthesisRun,
} from './synthesis-abort';

interface Cluster {
  id: string;
  title: string;
  summary: string;
  fact_ids: string[];
}

/** Cap facts sent to the LLM so the prompt stays bounded (mirrors postprocess). */
const MAX_FACTS_FOR_LLM = 200;

function emitSynthesis(sessionId: string, data: Record<string, unknown>): void {
  emit(sessionId, { type: 'synthesis', data: { seq: nextSeq(sessionId), ...data } });
}

/**
 * On-demand, streamed synthesis over a scoped subset of a session's facts.
 * Fire-and-forget: callers MUST NOT await this (it runs for the LLM's lifetime).
 * Errors are caught internally and recorded on the synthesis_runs row + emitted
 * as a 'synthesis' done/failed event — they never reject to the caller.
 */
export async function runSynthesis(
  sessionId: string,
  runId: string,
  scope: SynthesisScope,
): Promise<void> {
  // Re-attach an emitter even if the 30s post-completion cleanup tore it down,
  // so synthesis on a finished session still streams to live clients.
  ensureEmitter(sessionId);
  registerSynthesisRun(runId);
  const signal = getSynthesisSignal(runId)!;

  try {
    const plan = buildScopePlan(sessionId, scope);
    const factRows = await resolveFactSet(plan);
    const scopedFacts = factRows.slice(0, MAX_FACTS_FOR_LLM);

    emitSynthesis(sessionId, {
      runId,
      stage: 'started',
      scope,
      factCount: scopedFacts.length,
    });

    if (scopedFacts.length === 0) {
      await db
        .update(synthesisRuns)
        .set({
          status: 'complete',
          summary: 'No facts in scope to synthesise.',
          clusters: [],
          tokensUsed: 0,
          completedAt: new Date(),
        })
        .where(eq(synthesisRuns.id, runId));
      emitSynthesis(sessionId, { runId, stage: 'done', summary: '', clusters: [], tokensUsed: 0 });
      return;
    }

    const systemPrompt =
      'You are a research synthesiser organising a desk of loose facts into coherent themes. ' +
      'Only restate or synthesise the facts provided. Do NOT add information, claims, or context ' +
      'that is not directly present in those facts.';

    const factList = scopedFacts.map((f) => `[${f.id}] ${f.content}`).join('\n');

    // 1. Structured re-clustering (non-streamed). Same shape as postprocess.ts:178-184.
    let clusters: Cluster[] = [];
    let clusterTokens = 0;
    try {
      const result = await jsonCompletion<{
        clusters: { title: string; summary: string; fact_ids: string[] }[];
      }>(
        systemPrompt,
        `Group these facts into 4-8 coherent topic clusters. For each cluster return:\n` +
          `- title: a short descriptive label\n` +
          `- summary: 2-3 sentences that ONLY restate or synthesise the facts listed below\n` +
          `- fact_ids: list of fact IDs in this cluster\n\n` +
          `Facts:\n${factList}\n\nRespond with JSON: { "clusters": [...] }`,
        { maxTokens: 8192, signal },
      );
      clusters = (result.clusters ?? []).map((c, i) => ({
        id: `${runId}-c${i}`,
        title: c.title,
        summary: c.summary,
        fact_ids: Array.isArray(c.fact_ids) ? c.fact_ids : [],
      }));
    } catch (err) {
      if (isSynthesisAborted(runId)) throw err;
      console.error('[deepdive] synthesis clustering failed:', err);
      clusters = [
        {
          id: `${runId}-c0`,
          title: 'All Findings',
          summary: 'All scoped facts grouped together.',
          fact_ids: scopedFacts.map((f) => f.id),
        },
      ];
    }

    for (const cluster of clusters) {
      if (isSynthesisAborted(runId)) throw new Error('Synthesis cancelled');
      emitSynthesis(sessionId, { runId, stage: 'cluster', cluster });
    }

    // 2. Streamed executive summary. onToken -> synthesis.progress.
    const topFactContents = scopedFacts.map((f) => f.content).slice(0, 40);
    const { text: summary, tokensUsed: summaryTokens } = await streamCompletion(
      systemPrompt,
      `Write a 2-4 paragraph synthesis of these facts. ONLY use information present in them.\n\n` +
        `Facts:\n${topFactContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
      {
        maxTokens: 2000,
        signal,
        onToken: (token) => emitSynthesis(sessionId, { runId, stage: 'progress', token }),
      },
    );

    const tokensUsed = clusterTokens + summaryTokens;

    // 3. Persist the run + flip desk_state on the included facts.
    const includedIds = scopedFacts.map((f) => f.id);
    await db
      .update(synthesisRuns)
      .set({
        status: 'complete',
        summary,
        clusters,
        tokensUsed,
        completedAt: new Date(),
      })
      .where(eq(synthesisRuns.id, runId));

    if (includedIds.length > 0) {
      await db
        .update(facts)
        .set({ deskState: 'synthesized', synthesisRunId: runId })
        .where(and(eq(facts.sessionId, sessionId), inArray(facts.id, includedIds)));
    }

    emitSynthesis(sessionId, { runId, stage: 'done', summary, clusters, tokensUsed });
  } catch (err: any) {
    const cancelled = isSynthesisAborted(runId) || err?.name === 'AbortError';
    const status = cancelled ? 'cancelled' : 'failed';
    const message = err?.message ?? 'unknown error';
    console.error(`[deepdive] synthesis ${runId} ${status}:`, message);
    await db
      .update(synthesisRuns)
      .set({ status, errorMessage: message, completedAt: new Date() })
      .where(eq(synthesisRuns.id, runId))
      .catch((e) => console.error('[deepdive] failed to record synthesis error:', e));
    emit(sessionId, {
      type: 'error',
      message: `Synthesis ${status}: ${message}`,
      data: { seq: nextSeq(sessionId), runId, stage: status },
    });
  } finally {
    clearSynthesisRun(runId);
  }
}
