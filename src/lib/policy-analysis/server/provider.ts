import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyModelCalls, policyExecutions } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { executionContext, type LLMCallRecord } from '$lib/context/execution';
import { resolveResearchDeepModel } from '$lib/server/models/workload-settings';
import { coerceModelContext } from '$lib/constants/default-models';
import { PROMPT_VERSION, WORKFLOW_ID, type Artefact } from '../contracts';
import { PolicyError, validateOutput } from '../validation';
import { systemPrompt } from '../prompts';

export type ModelCall = (stage: number, key: string, input: unknown) => Promise<unknown>;
export function modelCaller(executionId: string, runId: string, signal: AbortSignal, prior: Artefact[]): ModelCall {
  return async (stage, key, input) => {
    const encoded = JSON.stringify(input);
    if (encoded.length > 180_000) throw new PolicyError('budget', 'The artefact inventory exceeds this implementation’s model context limit. Completed work is retained.');
    const inputHash = createHash('sha256').update(encoded).digest('hex');
    const [execution] = await db.select().from(policyExecutions).where(eq(policyExecutions.id, executionId));
    const [cached] = await db.select({ output: policyModelCalls.output }).from(policyModelCalls)
      .innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId))
      .where(and(eq(policyExecutions.stageId, execution.stageId), eq(policyModelCalls.inputHash, inputHash), eq(policyModelCalls.promptVersion, PROMPT_VERSION), eq(policyModelCalls.status, 'completed'))).limit(1);
    if (cached) return cached.output;
    const [call] = await db.insert(policyModelCalls).values({ executionId, callKey: key, promptVersion: PROMPT_VERSION, inputHash, input, status: 'running' }).returning();
    const llmCalls: LLMCallRecord[] = [];
    try {
      const selected = await resolveResearchDeepModel();
      const { client, model } = await getLLMClient(coerceModelContext({ modelId: selected.modelId }));
      await db.update(policyModelCalls).set({ model }).where(eq(policyModelCalls.id, call.id));
      const result = await executionContext.run({ workflowId: WORKFLOW_ID, runId, nodeId: executionId, llmCalls }, () =>
        client.chat.completions.create({ model, messages: [{ role: 'system', content: systemPrompt(stage) }, { role: 'user', content: encoded }], response_format: { type: 'json_object' }, max_tokens: 14000 }, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), maxRetries: 0 }),
      );
      const content = result.choices[0]?.message?.content ?? '';
      let output: unknown;
      try { output = JSON.parse(content); } catch {
        await db.update(policyModelCalls).set({ output: { malformedText: content.slice(0, 64000) } }).where(eq(policyModelCalls.id, call.id));
        throw new PolicyError('contract', 'The model returned malformed JSON. Resume to retry this stage.');
      }
      await db.update(policyModelCalls).set({ output }).where(eq(policyModelCalls.id, call.id));
      const validated = validateOutput(output, stage, prior);
      const prefix = (input as { idPrefix?: string }).idPrefix;
      if (prefix && validated.artefacts.some((a) => !a.id.startsWith(prefix))) throw new PolicyError('contract', 'The model did not use the assigned stable identifiers.');
      await db.update(policyModelCalls).set({ status: 'completed', output, usage: llmCalls, provider: llmCalls.at(-1)?.provider ?? null, model: llmCalls.at(-1)?.model ?? result.model, completedAt: new Date() }).where(eq(policyModelCalls.id, call.id));
      return output;
    } catch (err) {
      await db.update(policyModelCalls).set({ status: 'failed', usage: llmCalls, completedAt: new Date(), error: err instanceof PolicyError ? err.message : 'The configured model provider is unavailable or the call timed out.' }).where(eq(policyModelCalls.id, call.id));
      throw err instanceof PolicyError ? err : new PolicyError('provider', 'The configured model provider is unavailable or timed out. Check site connections, then resume.');
    }
  };
}
