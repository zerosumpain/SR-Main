import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { resolveMaxTokens } from './llm-helpers';

export { thinkDef } from './think.def';

export const thinkExecutor: NodeExecutor = {
  type: 'think',
  async execute(input, config, context): Promise<NodeResult> {
    const prompt = interpolateTemplate((config.prompt as string) || '', input);
    const temperature = (config.temperature as number) ?? 0.3;

    const systemPrompt = `You are a careful reasoning engine. Think step-by-step about the task.

Structure your response as:
<thinking>
[Your detailed step-by-step reasoning here]
</thinking>

[Your final conclusion/answer here]

Be thorough in your reasoning. Consider edge cases.`;

    const response = await resilientChatCompletion(
      config.model as string | undefined,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Input data:\n${JSON.stringify(input, null, 2)}\n\nTask: ${prompt}` },
        ],
        temperature,
        max_tokens: resolveMaxTokens(config.maxTokens),
      },
      { signal: context.abortSignal },
    );

    const content = response.choices[0]?.message?.content ?? '';
    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';
    const conclusion = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

    return {
      output: { ...input, reasoning, conclusion, fullResponse: content },
      metadata: { model: response.model, promptTokens: response.usage?.prompt_tokens ?? 0, completionTokens: response.usage?.completion_tokens ?? 0 },
      rowCount: 1,
    };
  },
  getInputSchema() { return { type: 'object', description: 'Data for the LLM to reason about' }; },
  getOutputSchema() {
    return { type: 'object', properties: {
      reasoning: { type: 'string', description: 'Step-by-step reasoning' },
      conclusion: { type: 'string', description: 'Final conclusion' },
      fullResponse: { type: 'string', description: 'Raw LLM response' },
    }};
  },
};

