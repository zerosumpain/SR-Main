import { db } from '$lib/db';
import { facts, synthesisRuns } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ensureEmitter, emit } from './worker';
import { nextSeq } from './desk-events';
import { streamCompletion, jsonCompletion } from './ai';
import { buildScopePlan, resolveFactSet, type SynthesisScope } from './synthesis-scope';
import { reconcileClusters, type LlmCluster } from './synthesis-reconcile';
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

    // Present facts to the LLM by 1-based bracket number, NOT by UUID. GLM-class
    // models truncate/reformat/hallucinate long UUIDs, which silently breaks the
    // downstream join (cluster fact_ids never match any card id → nothing files on
    // the desk). The model returns integer indices; we map them back to real
    // UUIDs server-side via this index→id map. (Also keeps the prompt shorter,
    // easing the GLM reasoning-token budget on the structured call.)
    const allIds = scopedFacts.map((f) => f.id);
    const idByIndex = new Map<number, string>();
    scopedFacts.forEach((f, i) => idByIndex.set(i + 1, f.id));
    const factList = scopedFacts.map((f, i) => `[${i + 1}] ${f.content}`).join('\n');

    // 1. Structured re-clustering (non-streamed). The model references facts by
    //    their bracket NUMBER; we reconcile indices → real UUIDs below.
    //    maxTokens 8192 (≥3000) keeps the JSON from being truncated by GLM's
    //    reasoning-token spend (repo memory: glm burns reasoning from max_tokens).
    let clusters: Cluster[] = [];
    let clusterTokens = 0;
    try {
      const result = await jsonCompletion<{ clusters: LlmCluster[] }>(
        systemPrompt,
        `Group these facts into 4-8 coherent topic clusters. Reference each fact by ` +
          `the bracketed NUMBER shown before it (e.g. [3] → 3). For each cluster return:\n` +
          `- title: a short descriptive label\n` +
          `- summary: 2-3 sentences that ONLY restate or synthesise the facts listed below\n` +
          `- facts: array of the integer fact NUMBERS in this cluster (e.g. [1, 4, 7])\n\n` +
          `Facts:\n${factList}\n\n` +
          `Respond with JSON: { "clusters": [ { "title": "...", "summary": "...", "facts": [1, 2] } ] }`,
        { maxTokens: 8192, signal },
      );
      // Map indices → real UUIDs, drop invalid, and fall back to one all-ids
      // cluster if the model produced nothing usable.
      clusters = reconcileClusters(result.clusters ?? [], idByIndex, allIds, runId);
    } catch (err) {
      if (isSynthesisAborted(runId)) throw err;
      console.error('[deepdive] synthesis clustering failed:', err);
      clusters = [
        {
          id: `${runId}-c0`,
          title: 'All Findings',
          summary: 'All scoped facts grouped together.',
          fact_ids: allIds,
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
    const includedIds = allIds;
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

    // Persist deskState + synthesisRunId for all scoped facts (bulk pass).
    if (includedIds.length > 0) {
      await db
        .update(facts)
        .set({ deskState: 'synthesized', synthesisRunId: runId })
        .where(and(eq(facts.sessionId, sessionId), inArray(facts.id, includedIds)));
    }

    // Persist deskCategory per cluster so group-by-cluster survives reload.
    for (const cluster of clusters) {
      if (cluster.fact_ids.length > 0) {
        await db
          .update(facts)
          .set({ deskCategory: cluster.id })
          .where(and(eq(facts.sessionId, sessionId), inArray(facts.id, cluster.fact_ids)));
      }
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
