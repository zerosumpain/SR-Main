import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

export const thinkExecutor: NodeExecutor = {
  type: 'think',
  async execute(input, config, _context): Promise<NodeResult> {
    const model = (config.model as string) || 'openai/gpt-4o-mini';
    const prompt = interpolateTemplate((config.prompt as string) || '', input);
    const temperature = (config.temperature as number) ?? 0.3;

    const systemPrompt = `You are a careful reasoning engine. Think step-by-step about the task.

Structure your response as:
<thinking>
[Your detailed step-by-step reasoning here]
</thinking>

[Your final conclusion/answer here]

Be thorough in your reasoning. Consider edge cases.`;

    const client = getOpenRouterClient();
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Input data:\n${JSON.stringify(input, null, 2)}\n\nTask: ${prompt}` },
      ],
      temperature,
      max_tokens: (config.maxTokens as number) ?? 2048,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';
    const conclusion = content.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

    return {
      output: { ...input, reasoning, conclusion, fullResponse: content },
      metadata: { model, promptTokens: response.usage?.prompt_tokens ?? 0, completionTokens: response.usage?.completion_tokens ?? 0 },
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

export const thinkDef: NodeDefinition = {
  type: 'think', label: 'Think', category: 'agentic',
  description: 'Chain-of-thought reasoning. LLM reasons step-by-step, outputs reasoning + conclusion.',
  configSchema: { type: 'object', properties: {
    prompt: { type: 'string', description: 'What to reason about. Supports {{input.field}} templates.' },
    model: { type: 'string', description: 'OpenRouter model ID' },
    temperature: { type: 'number', description: 'Sampling temperature (default 0.3)' },
    maxTokens: { type: 'number', description: 'Max tokens (default 2048)' },
  }, required: ['prompt'] },
  defaultConfig: { prompt: '', model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Reasoning' }],
  basicConfig: [
    {
      key: 'prompt',
      label: 'Reasoning Task',
      type: 'template-textarea',
      placeholder: 'Analyze the data and determine the best course of action.',
      description: 'What you want the LLM to think about. Use {{input.field}} to reference incoming data.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'Which LLM runs this step',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      step: 0.1,
      description: 'Lower = more focused, higher = more creative',
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      type: 'number',
      advancedOnly: true,
      description: 'Maximum length of the LLM response',
    },
  ],
  llmDescription: 'Use when the workflow needs careful deliberation before a decision. Place before Conditional or Router nodes so decisions are informed by explicit reasoning.',
  llmExamples: [{ prompt: 'Analyze the health data and determine if the user should be alerted.', model: 'openai/gpt-4o', temperature: 0.2 }],
};
