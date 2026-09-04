import type { NodeDefinition } from '../types';

export const researchResultDef: NodeDefinition = {
  type: 'research-result',
  label: 'Research Result',
  category: 'core',
  description:
    'Display node for a commissioned deep/quick research session. Pulses while pending; populates when complete.',
  configSchema: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['deep', 'quick'] },
      sessionId: { type: 'string' },
      topic: { type: 'string' },
    },
  },
  defaultConfig: { engine: 'deep', sessionId: '', topic: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'engine',
      label: 'Engine',
      type: 'dropdown',
      options: [
        { value: 'deep', label: 'Deep research' },
        { value: 'quick', label: 'Quick research' },
      ],
      section: 'SOURCE',
    },
    {
      key: 'sessionId',
      label: 'Session ID',
      type: 'template-textarea',
      description: 'Existing session ID. Supports {{input.*}} placeholders from an upstream connection.',
      placeholder: '{{input.researchSessionId}}',
      section: 'SOURCE',
    },
  ],
  llmDescription:
    "Display-only node that renders a previously-commissioned research session (deep or quick) on the canvas. Does NOT start a new session — it just polls the given sessionId and surfaces the report. Use when an upstream node (deep-research / quick-answer) emits researchSessionId and you want the result visible on the canvas as a separate stage. If you only need the report's text downstream and don't care about the canvas display, skip this node and read directly from deep-research's output.",
  llmExamples: [
    { engine: 'deep', sessionId: '{{input.researchSessionId}}' },
    { engine: 'quick', sessionId: '{{trigger.output.sessionId}}' },
  ],
};
