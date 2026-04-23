import type { NodeDefinition } from '../types';

export const interactiveStepDef: NodeDefinition = {
  type: 'interactive-step',
  category: 'control',
  label: 'Interactive Step',
  description: 'Pauses the workflow for a human to solve a CAPTCHA, log in, or confirm data. Resumes after the human completes it from the canvas.',
  defaultConfig: {
    mode: 'vnc',
    profile: '',
    url: '',
    prompt: 'Please complete the required action',
    fields: [],
    timeoutMinutes: 60,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Completion' }],
  configSchema: {
    type: 'object',
    required: ['mode', 'prompt'],
    properties: {
      mode: { type: 'string', enum: ['vnc', 'confirm', 'both'], description: 'What kind of human interaction' },
      profile: { type: 'string', description: 'Scraper profile name (for vnc / both)' },
      url: { type: 'string', description: 'URL to open in the browser (for vnc / both; supports {{input.x}} templates)' },
      prompt: { type: 'string', description: 'Instruction shown to the human' },
      fields: {
        type: 'array',
        description: 'Form fields shown alongside the VNC (for confirm / both)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'boolean'] },
            label: { type: 'string' },
            defaultValueTemplate: { type: 'string' },
          },
          required: ['name', 'type', 'label'],
        },
      },
      timeoutMinutes: { type: 'number', description: 'Auto-cancel after N minutes (default 60)' },
    },
  },
};
