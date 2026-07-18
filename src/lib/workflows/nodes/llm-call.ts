import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplateStrict } from './template';
import { resilientChatCompletion, resilientChatStream } from '$lib/llm/workflow-gateway';
import { isGlmModel } from '$lib/constants/default-models';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export { llmCallDef } from './llm-call.def';

/**
 * Parse an outputSchema config value into a schema object. Accepts either a raw
 * object (advanced JSON config) or a JSON string (basicConfig `code` widget).
 * Returns null when unset/empty; throws on an invalid JSON string.
 */
function parseOutputSchema(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'object') {
    return Object.keys(raw as object).length > 0 ? (raw as Record<string, unknown>) : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`llm-call: outputSchema is not valid JSON — ${(err as Error).message}`);
    }
    if (parsed && typeof parsed === 'object' && Object.keys(parsed as object).length > 0) {
      return parsed as Record<string, unknown>;
    }
    return null;
  }
  return null;
}

/** Best-effort JSON extraction: strips ```json fences and, failing a clean
 *  parse, pulls the first {...} / [...] span out of surrounding prose. */
function tryParseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let s = content.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    /* fall through to span extraction */
  }
  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    try {
      return { ok: true, value: JSON.parse(s.slice(objStart, objEnd + 1)) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return { ok: true, value: JSON.parse(s.slice(arrStart, arrEnd + 1)) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: 'no JSON object or array found in the response' };
}

export const llmCallExecutor: NodeExecutor = {
  type: 'llm-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const { result: systemPrompt, missingPaths: sysMissing } = interpolateTemplateStrict((config.systemPrompt as string) || '', input);
    const { result: userPrompt, missingPaths: userMissing } = interpolateTemplateStrict((config.userPrompt as string) || '', input);
    const missing = [...sysMissing, ...userMissing];
    if (missing.length > 0) {
      throw new Error(`Prompt template references unresolved: ${missing.join(', ')}. Check upstream node output.`);
    }
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 2048;
    const configuredModel = config.model as string | undefined;
    const outputSchema = parseOutputSchema(config.outputSchema);

    // ------------------------------------------------------------------
    // Structured-output mode: request JSON, parse + validate, retry once.
    // ------------------------------------------------------------------
    if (outputSchema) {
      return await runStructured({
        outputSchema,
        systemPrompt,
        userPrompt,
        temperature,
        maxTokens,
        configuredModel,
        context,
      });
    }

    const messages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user' as const, content: userPrompt },
    ];

    // If this run originated from a canvas chat send, the /chat endpoint
    // threads `_chatNodeId` through initialInput. Emit token deltas as
    // `chat_stream` log events so the chat pane streams the reply live,
    // even when the chat node is acting as a passthrough trigger.
    const chatNodeId = typeof input._chatNodeId === 'string' ? input._chatNodeId : null;
    const nodeId = (context as unknown as { _currentNodeId?: string })._currentNodeId;

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let usedModel = configuredModel ?? 'default';

    if (chatNodeId) {
      // Streamed: resilient (concurrency + idle-timeout + OpenRouter model
      // fallback before the first token). Token deltas stream to the chat pane.
      const r = await resilientChatStream(
        configuredModel,
        { messages, temperature, max_tokens: maxTokens },
        {
          signal: context.abortSignal,
          onToken: (delta) => {
            context.emit({
              type: 'log',
              runId: context.runId,
              nodeId,
              data: { kind: 'chat_stream', chatNodeId, event: { type: 'token', delta } },
              timestamp: new Date().toISOString(),
            });
          },
        },
      );
      content = r.content;
      promptTokens = r.promptTokens;
      completionTokens = r.completionTokens;
      usedModel = r.model || usedModel;
    } else {
      const response = await resilientChatCompletion(
        configuredModel,
        { messages, temperature, max_tokens: maxTokens },
        { signal: context.abortSignal },
      );
      content = response.choices[0]?.message?.content ?? '';
      promptTokens = response.usage?.prompt_tokens ?? 0;
      completionTokens = response.usage?.completion_tokens ?? 0;
      usedModel = response.model || usedModel;
    }

    return {
      output: {
        response: content,
        usage: { promptTokens, completionTokens },
      },
      metadata: {
        model: usedModel,
        promptTokens,
        completionTokens,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    const hasSchema = config.outputSchema !== undefined && config.outputSchema !== null && config.outputSchema !== '';
    if (hasSchema) {
      return {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'The parsed JSON object matching outputSchema' },
          response: { type: 'string', description: 'Raw LLM response text (the JSON as a string)' },
          usage: {
            type: 'object',
            properties: {
              promptTokens: { type: 'number' },
              completionTokens: { type: 'number' },
            },
          },
        },
      };
    }
    return {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response text' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };
  },
};

/**
 * Structured-output path. Requests a JSON object, validates that all top-level
 * `required` keys declared by the schema are present, retries ONCE with the
 * validation error appended, then fails into the node's `_onError` path.
 */
async function runStructured(args: {
  outputSchema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  configuredModel: string | undefined;
  context: ExecutionContext;
}): Promise<NodeResult> {
  const { outputSchema, systemPrompt, userPrompt, temperature, maxTokens, configuredModel, context } = args;

  const requiredKeys = Array.isArray(outputSchema.required)
    ? (outputSchema.required as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];
  const schemaText = JSON.stringify(outputSchema);

  const structuredSystem =
    `${systemPrompt ? `${systemPrompt}\n\n` : ''}` +
    `You MUST respond with ONLY a single valid JSON object (no prose, no code fences) that conforms to this JSON schema:\n${schemaText}`;

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: structuredSystem },
    { role: 'user', content: userPrompt },
  ];

  // GLM burns reasoning tokens from max_tokens (feedback_glm_reasoning_tokens),
  // and this applies via OpenRouter too — so keep a generous floor for GLM
  // models. An empty/default model id resolves to the GLM site default, so it
  // counts as GLM. Non-GLM slugs keep their configured budget. The z.ai-only
  // `thinking` param is gone: everything routes via OpenRouter, which rejects it.
  const isGlm = !configuredModel || isGlmModel(configuredModel);
  const structuredMaxTokens = isGlm ? Math.max(maxTokens, 3000) : maxTokens;

  const attempt = async (messages: ChatCompletionMessageParam[]) => {
    const response = await resilientChatCompletion(
      configuredModel,
      {
        messages,
        temperature,
        max_tokens: structuredMaxTokens,
        response_format: { type: 'json_object' },
      },
      { signal: context.abortSignal },
    );
    return {
      content: response.choices[0]?.message?.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model || configuredModel || 'default',
    };
  };

  let messages = baseMessages;
  let lastError = '';
  for (let i = 0; i < 2; i++) {
    const r = await attempt(messages);
    const parsed = tryParseJson(r.content);
    if (parsed.ok) {
      const value = parsed.value;
      const missing =
        value && typeof value === 'object' && !Array.isArray(value)
          ? requiredKeys.filter((k) => !(k in (value as Record<string, unknown>)))
          : requiredKeys; // a non-object result cannot satisfy required keys
      if (missing.length === 0) {
        return {
          output: {
            data: value,
            response: r.content,
            usage: { promptTokens: r.promptTokens, completionTokens: r.completionTokens },
          },
          metadata: { model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, structured: true },
          rowCount: 1,
        };
      }
      lastError = `missing required keys: ${missing.join(', ')}`;
    } else {
      lastError = `not valid JSON (${parsed.error})`;
    }

    // Retry once, feeding the model its own bad answer + the validation error.
    messages = [
      ...baseMessages,
      { role: 'assistant', content: r.content },
      {
        role: 'user',
        content: `Your previous response was invalid: ${lastError}. Reply again with ONLY a corrected JSON object — no prose, no code fences.`,
      },
    ];
  }

  throw new Error(`llm-call: structured output invalid after one retry — ${lastError}`);
}
