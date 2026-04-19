import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplateStrict } from './template';
import { resolveLLMClient } from './llm-helpers';

export { llmCallDef } from './llm-call.def';

export const llmCallExecutor: NodeExecutor = {
  type: 'llm-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const { result: systemPrompt, missingPaths: sysMissing } = interpolateTemplateStrict((config.systemPrompt as string) || '', input);
    const { result: userPrompt, missingPaths: userMissing } = interpolateTemplateStrict((config.userPrompt as string) || '', input);
    const missing = [...sysMissing, ...userMissing];
    if (missing.length > 0) {
      throw new Error(`Prompt template references unresolved: ${missing.join(', ')}. Check upstream node output.`);
    }
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 1024;

    const { client, model } = await resolveLLMClient(config.model as string | undefined);

    const response = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    return {
      output: {
        response: content,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
      },
      metadata: {
        model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      },
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

