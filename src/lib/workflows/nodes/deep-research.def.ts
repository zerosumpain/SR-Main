import type { NodeDefinition } from '../types';
import { RESEARCH_DEPTHS } from '$lib/deepdive/depth';

export const deepResearchDef: NodeDefinition = {
  type: 'deep-research',
  label: 'Deep Research',
  category: 'core',
  description:
    'DAG-driven deep research (commission via pipeline). Emits researchReport + sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'string' },
      depth: { type: 'string', enum: [...RESEARCH_DEPTHS] },
      pollIntervalMs: { type: 'number' },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: {
    topic: '{{item.title}}',
    goals: '',
    depth: 'brief',
    pollIntervalMs: 5000,
    maxWaitMs: 900000,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research deeply. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific angles or questions. One per line.',
      section: 'QUERY',
    },
    {
      key: 'depth',
      label: 'Depth',
      type: 'dropdown',
      options: [
        { value: 'instant', label: 'Instant — model knowledge, no sources' },
        { value: 'scan', label: 'Scan — one search round, cited (~90s)' },
        { value: 'brief', label: 'Brief — sources + facts (under 2 min)' },
        { value: 'investigation', label: 'Investigation — full engine (20 min+)' },
      ],
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '900000',
      section: 'ADVANCED',
    },
  ],
  llmDescription:
    "Commission a long-running deep-research session and block until it finishes (or maxWaitMs elapses). Outputs { researchEngine: 'deep', researchSessionId, researchStatus, researchReport, sources }. Use for thorough investigations where you want a multi-paragraph synthesis with citations — costs minutes of wall-clock time and several LLM calls. For a fast 1-2 paragraph answer use `quick-answer` instead. Pair with a `research-result` display node downstream if you want the canvas to render the report nicely. Templates allowed in topic/goals (e.g. {{input.title}}).",
  llmExamples: [
    { topic: '{{input.title}}', depth: 'brief' },
    { topic: 'Latest advances in solid-state batteries 2026', goals: 'Players, technical readiness, commercialisation timelines', depth: 'investigation' },
  ],
};
