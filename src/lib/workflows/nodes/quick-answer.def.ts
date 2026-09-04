import type { NodeDefinition } from '../types';

export const quickAnswerDef: NodeDefinition = {
  type: 'quick-answer',
  label: 'Quick Answer',
  category: 'core',
  description:
    'Run a quick-answer session (Tavily + synthesis). Polls until complete; returns the answer and sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'array', items: { type: 'string' } },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: { topic: '{{item.title}}', goals: [], maxWaitMs: 180000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Answer' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific questions or angles. One per line.',
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '180000',
      section: 'ADVANCED',
    },
  ],
  llmDescription: `Run a fast single-topic research session (Tavily search + LLM synthesis) and wait for it to complete. Returns a written answer plus sources. Cheaper/faster than the full \`deep-research\` node — use for a quick briefing on one \`topic\` (supports {{input.*}}/{{item.*}}). Output includes researchReport, researchSources, researchStatus.`,
  llmExamples: [
    { topic: 'Latest developments in {{input.subject}}' },
    { topic: '{{item.title}}', goals: ['key players', 'risks'] },
  ],
};
