import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyModelCalls, policyExecutions } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { executionContext, type LLMCallRecord } from '$lib/context/execution';
import { resolveResearchDeepModel } from '$lib/server/models/workload-settings';
import { coerceModelContext } from '$lib/constants/default-models';
import { PROMPT_VERSION, WORKFLOW_ID, type Artefact, type StageOutput } from '../contracts';
import { fitToBudget } from '../budget';
import { PolicyError, triageOutput, type Rejection } from '../validation';
import { repairPrompt, systemPrompt } from '../prompts';

export type ModelCall = (stage: number, key: string, input: unknown) => Promise<StageOutput>;

/**
 * How many corrective round-trips a single unit of work gets before it is
 * abandoned. Zero was the shipped behaviour and it is why the first production
 * run failed: the validator knew precisely which artefact was wrong and why, and
 * told nobody, least of all the model. A retry re-sent a byte-identical prompt,
 * so a deterministic contract failure was a deterministic dead end.
 */
const REPAIR_ROUNDS = 2;

/** Serialised characters one model call may carry. */
const CONTEXT_LIMIT = 180_000;

/** Repair is worth a call when the response was mostly, or entirely, unusable. */
function needsRepair(kept: number, rejected: Rejection[]): boolean {
  if (!rejected.length) return false;
  return kept === 0 || rejected.length >= Math.max(3, Math.ceil(kept / 2));
}

export function modelCaller(executionId: string, runId: string, signal: AbortSignal, prior: Artefact[]): ModelCall {
  return async (stage, key, input) => {
    const { protect: pinned, ...payload } = input as { artefacts?: Artefact[]; protect?: string[] };
    const fitted = Array.isArray(payload.artefacts)
      ? fitToBudget(payload.artefacts, (artefacts) => ({ ...payload, artefacts }), CONTEXT_LIMIT, new Set(pinned ?? []))
      : { artefacts: [], notes: [] };
    input = Array.isArray(payload.artefacts) ? { ...payload, artefacts: fitted.artefacts } : payload;
    const encoded = JSON.stringify(input);
    if (encoded.length > CONTEXT_LIMIT) throw new PolicyError('budget', 'This call exceeds the model’s context window even after trimming. Completed work is retained.');
    const inputHash = createHash('sha256').update(encoded).digest('hex');
    const prefix = (input as { idPrefix?: string }).idPrefix ?? '';
    const [execution] = await db.select().from(policyExecutions).where(eq(policyExecutions.id, executionId));
    const [cached] = await db.select({ output: policyModelCalls.output }).from(policyModelCalls)
      .innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId))
      .where(and(eq(policyExecutions.stageId, execution.stageId), eq(policyModelCalls.inputHash, inputHash), eq(policyModelCalls.promptVersion, PROMPT_VERSION), eq(policyModelCalls.status, 'completed'))).limit(1);
    if (cached) {
      const reused = accept(triageOutput(cached.output, stage, prior), prefix).output;
      return { artefacts: reused.artefacts, warnings: [...fitted.notes, ...reused.warnings] };
    }

    const selected = await resolveResearchDeepModel();
    const { client, model } = await getLLMClient(coerceModelContext({ modelId: selected.modelId }));
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt(stage) },
      { role: 'user', content: encoded },
    ];

    const accepted: Artefact[] = [];
    const warnings: string[] = [...fitted.notes];
    let lastError: PolicyError | null = null;

    for (let round = 0; round <= REPAIR_ROUNDS; round++) {
      signal.throwIfAborted();
      const callKey = round ? `${key}#repair${round}` : key;
      // A repair round returns ONLY the corrected subset. Storing it under the
      // original input hash would let the unordered cache lookup replay that
      // fragment as if it were the whole response.
      const roundHash = round ? createHash('sha256').update(`${inputHash}#repair${round}`).digest('hex') : inputHash;
      const [call] = await db.insert(policyModelCalls).values({ executionId, callKey, promptVersion: PROMPT_VERSION, inputHash: roundHash, input: round ? { repairOf: key, round, instruction: messages.at(-1)?.content.slice(0, 20000) } : input, status: 'running', model }).returning();
      const llmCalls: LLMCallRecord[] = [];
      try {
        const result = await executionContext.run({ workflowId: WORKFLOW_ID, runId, nodeId: executionId, llmCalls }, () =>
          client.chat.completions.create({ model, messages, response_format: { type: 'json_object' }, max_tokens: 14000 }, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), maxRetries: 0 }),
        );
        const content = result.choices[0]?.message?.content ?? '';
        // A reply cut off at max_tokens is not malformed JSON, and saying so sends
        // the repair round chasing a syntax error that is not there.
        const truncated = result.choices[0]?.finish_reason === 'length';
        let output: unknown;
        try { output = JSON.parse(content); } catch {
          await db.update(policyModelCalls).set({ output: { malformedText: content.slice(0, 64000), finishReason: result.choices[0]?.finish_reason ?? null } }).where(eq(policyModelCalls.id, call.id));
          throw new PolicyError('contract', truncated
            ? 'The model’s reply was cut off at its output limit before the structured result was complete. Fewer items per call are needed here.'
            : 'The model returned malformed JSON. Resume to retry this stage.');
        }
        if (truncated) warnings.push('The model reached its output limit on this call, so its list may be incomplete.');
        await db.update(policyModelCalls).set({ output }).where(eq(policyModelCalls.id, call.id));

        const { output: round1, rejected } = accept(triageOutput(output, stage, [...prior, ...accepted]), prefix);
        accepted.push(...round1.artefacts);
        warnings.push(...round1.warnings);
        await db.update(policyModelCalls).set({ status: 'completed', output, usage: llmCalls, provider: llmCalls.at(-1)?.provider ?? null, model: llmCalls.at(-1)?.model ?? result.model, completedAt: new Date() }).where(eq(policyModelCalls.id, call.id));

        if (!needsRepair(round1.artefacts.length, rejected) || round === REPAIR_ROUNDS) {
          if (!accepted.length) throw lastError ?? new PolicyError(rejected[0]?.code ?? 'contract', rejected[0]?.reason ?? 'The model returned nothing this stage could use.');
          return { artefacts: accepted, warnings };
        }
        lastError = new PolicyError(rejected[0]?.code ?? 'contract', rejected[0]?.reason ?? 'Output was discarded.');
        const instruction = repairPrompt(rejected, prefix, truncated);
        // The conversation grows by the echo plus the instruction; the ceiling
        // applies to what is SENT, not only to the first request.
        const room = CONTEXT_LIMIT - encoded.length - instruction.length - 2_000;
        if (room < 4_000) { if (!accepted.length) throw lastError; return { artefacts: accepted, warnings: [...warnings, 'There was no room left in the model’s context window for a corrective attempt.'] }; }
        messages.push({ role: 'assistant', content: content.slice(0, room) }, { role: 'user', content: instruction });
      } catch (err) {
        await db.update(policyModelCalls).set({ status: 'failed', usage: llmCalls, completedAt: new Date(), error: err instanceof PolicyError ? err.message : 'The configured model provider is unavailable or the call timed out.' }).where(eq(policyModelCalls.id, call.id));
        if (accepted.length && err instanceof PolicyError) return { artefacts: accepted, warnings: [...warnings, `A corrective attempt failed (${err.message}); the assessment keeps what was already accepted.`] };
        throw err instanceof PolicyError ? err : new PolicyError('provider', 'The configured model provider is unavailable or timed out. Check site connections, then resume.');
      }
    }
    throw lastError ?? new PolicyError('contract', 'The model could not satisfy this stage’s contract.');
  };
}

/**
 * Identifiers are the join key for every provenance link, so an artefact minted
 * outside its assigned prefix cannot be referenced later. Quarantine it like any
 * other faulty artefact rather than failing the whole response — the repair
 * round then gets told exactly what the prefix is.
 */
function accept(triaged: { artefacts: Artefact[]; warnings: string[]; rejected: Rejection[] }, prefix: string) {
  if (!prefix) return { output: { artefacts: triaged.artefacts, warnings: triaged.warnings }, rejected: triaged.rejected };
  const rejected = [...triaged.rejected];
  const kept = triaged.artefacts.filter((a) => {
    if (a.id.startsWith(prefix)) return true;
    rejected.push({ id: a.id, kind: a.kind, code: 'identifier', reason: `Identifiers for this call must begin with “${prefix}”.` });
    return false;
  });
  const warnings = [...triaged.warnings];
  const strays = rejected.length - triaged.rejected.length;
  if (strays) warnings.push(`${strays} model output${strays === 1 ? '' : 's'} used identifiers outside this call's namespace and could not be linked into the assessment.`);
  return { output: { artefacts: kept, warnings }, rejected };
}
