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
  llmDescription: 'Downstream of `stealth-scrape` when the pages have narrative text or a brittle DOM that CSS selectors cannot reliably target. Takes `sourcePath` pointing at the scraped data in the input (e.g. "input.scraped.pages"), a JSON Schema describing fields to extract, and optionally `itemTextPath` when sourcePath is an array of page objects and you want to pull text from a nested property of each. The LLM reads each page/item and returns structured JSON matching the schema. Use when: table layouts shift, data is embedded in prose, or selectors break across pagination variations. Outputs { extracted: <schema-shaped object or array>, model, usage }.',
  llmExamples: [
    {
      sourcePath: 'input.scraped.pages',
      itemTextPath: 'text',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            salary: { type: 'string' },
            closingDate: { type: 'string' },
            location: { type: 'string' },
          },
          required: ['title'],
        },
      },
    },
    {
      sourcePath: 'input.scraped.pages',
      itemTextPath: 'html',
      schema: {
        type: 'object',
        properties: {
          companyName: { type: 'string' },
          founded: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['companyName'],
      },
      instructions: 'Return null for any field not clearly stated on the page.',
    },
    {
      sourcePath: 'input.text',
      schema: {
        type: 'object',
        properties: {
          price: { type: 'number' },
          currency: { type: 'string' },
          availability: { type: 'string', enum: ['in_stock', 'out_of_stock', 'unknown'] },
        },
      },
    },
  ],
  basicConfig: [
    {
      key: 'sourcePath',
      label: 'Source Path',
      type: 'text',
      placeholder: 'input.scraped.pages',
      description: 'Dot path to the string or array in the input to extract from (e.g. output from stealth-scrape).',
    },
    {
      key: 'itemTextPath',
      label: 'Item Text Path',
      type: 'text',
      placeholder: 'text',
      description: 'When sourcePath is an array of objects, the property inside each to read as text (e.g. "text" or "html").',
    },
    {
      key: 'schema',
      label: 'Extraction Schema',
      type: 'code',
      description: 'JSON Schema describing the fields to extract. The LLM will populate this shape from the source text.',
    },
    {
      key: 'instructions',
      label: 'Extra Instructions',
      type: 'template-textarea',
      placeholder: 'Return null for any field not clearly stated.',
      description: 'Optional guidance appended to the extraction prompt.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
};
