import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const mergeExecutor: NodeExecutor = {
  type: 'merge',
  async execute(input, config, _context): Promise<NodeResult> {
    const strategy = (config.strategy as string) || 'deep-merge';
    if (strategy === 'pick') {
      const fields = ((config.fields as string) || '').split(',').map(f => f.trim()).filter(Boolean);
      const output: Record<string, unknown> = {};
      for (const field of fields) { if (field in input) output[field] = input[field]; }
      return { output };
    }
    return { output: { ...input } };
  },
  getInputSchema() { return { type: 'object', description: 'Merged data from all upstream nodes' }; },
  getOutputSchema() { return { type: 'object', description: 'Merged output according to strategy' }; },
};

export const mergeDef: NodeDefinition = {
  type: 'merge', label: 'Merge', category: 'control',
  description: 'Explicitly merge data from multiple upstream nodes. Strategies: deep-merge (default), pick specific fields.',
  configSchema: { type: 'object', properties: {
    strategy: { type: 'string', description: "'deep-merge' or 'pick'" },
    fields: { type: 'string', description: 'Comma-separated field names to pick' },
  }},
  defaultConfig: { strategy: 'deep-merge', fields: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Merged' }],
  basicConfig: [
    {
      key: 'strategy',
      label: 'Strategy',
      type: 'dropdown',
      description: 'How to combine data from upstream nodes',
      options: [
        { value: 'deep-merge', label: 'Deep merge (combine all fields)' },
        { value: 'pick', label: 'Pick (select specific fields)' },
      ],
    },
    {
      key: 'fields',
      label: 'Fields',
      type: 'template-textarea',
      placeholder: 'response, status',
      description: 'Comma-separated field names',
      visibleWhen: { key: 'strategy', equals: 'pick' },
    },
  ],
  llmDescription: 'Use after parallel branches converge to control how upstream data is combined.',
};
