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
  llmDescription: `Run a snippet of JavaScript (Node.js), Python 3, or Bash in a sandbox. The upstream payload is available as \`input\` (JS/Python) — return or print JSON to pass data downstream. Use for custom transforms, math, or glue logic that no dedicated node covers. Prefer \`transform\` for simple JS reshaping; use this for Python/Bash or multi-step logic. Declare \`outputSchema\` to give downstream nodes autocomplete.`,
  llmExamples: [
    { language: 'javascript', code: 'return { total: input.items.length };' },
    { language: 'python', code: 'import json\nprint(json.dumps({"n": len(input["rows"])}))' },
  ],
};
