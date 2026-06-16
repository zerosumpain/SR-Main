import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplateStrict } from './template';
import { resilientChatCompletion, resilientChatStream } from '$lib/llm/workflow-gateway';

export { llmCallDef } from './llm-call.def';

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
      // Streamed: resilient (concurrency + idle-timeout + z.ai→OpenRouter
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

  getOutputSchema() {
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

