import type { NodeDefinition } from '../types';

export const stealthScrapeLlmDef: NodeDefinition = {
  type: 'stealth-scrape-llm',
  category: 'integration',
  label: 'Stealth Scrape (LLM Extract)',
  description: 'Extracts structured fields from scraped HTML/text via an LLM. Use when CSS selectors are too brittle.',
  defaultConfig: {
    sourcePath: '',
    schema: { type: 'object', properties: {} },
    model: '',
    itemTextPath: '',
    instructions: '',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Extracted result' }],
  configSchema: {
    type: 'object',
    required: ['sourcePath', 'schema'],
    properties: {
      sourcePath: {
        type: 'string',
        description: 'Dot path in input to the string or array to process. e.g. "input.scraped.pages"',
      },
      itemTextPath: {
        type: 'string',
        description: 'When sourcePath is an array, the path inside each item to pull text from',
      },
      schema: { type: 'object', description: 'JSON Schema describing fields to extract' },
      model: { type: 'string', description: 'OpenRouter / provider model id' },
      instructions: { type: 'string', description: 'Extra instructions appended to the extraction prompt' },
    },
  },
};
