import type { NodeDefinition } from '../types';

export const codeExecuteDef: NodeDefinition = {
  type: 'code-execute',
  label: 'Code Execute',
  category: 'core',
  description: 'Run JavaScript, Python, or Bash code in a sandboxed environment.',
  configSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language: javascript, python, or bash',
      },
      code: {
        type: 'string',
        description: 'Code to execute. Input data is available as `input` variable.',
      },
      outputSchema: {
        type: 'object',
        description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
      },
    },
    required: ['code'],
  },
  defaultConfig: { language: 'javascript', code: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'language',
      label: 'Language',
      type: 'dropdown',
      description: 'Which interpreter runs your code',
      options: [
        { value: 'javascript', label: 'JavaScript (Node.js)' },
        { value: 'python', label: 'Python 3' },
        { value: 'bash', label: 'Bash' },
      ],
    },
    {
      key: 'code',
      label: 'Code',
      type: 'code',
      description: 'Input from the previous node is available as `input`. Print or return JSON to pass data downstream.',
    },
    {
      key: 'outputSchema',
      label: 'Output shape (optional)',
      type: 'textarea',
      description: 'JSON schema describing what your code returns — enables autocomplete on downstream nodes.',
      advancedOnly: true,
    },
  ],
};
