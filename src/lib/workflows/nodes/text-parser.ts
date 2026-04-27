import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';

export const textParserExecutor: NodeExecutor = {
  type: 'text-parser',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as string) || 'json';
    const inputField = (config.inputField as string) || 'response';
    const text = String(input[inputField] ?? '');

    if (mode === 'json') {
      // Try direct JSON.parse first
      try {
        const parsed = JSON.parse(text);
        return { output: { ...input, parsed }, rowCount: 1 };
      } catch {
        // fall through
      }

      // Try extracting from markdown ```json ... ``` block
      const mdMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (mdMatch) {
        try {
          const parsed = JSON.parse(mdMatch[1].trim());
          return { output: { ...input, parsed }, rowCount: 1 };
        } catch {
          // fall through
        }
      }

      // Try finding first {...} or [...] in text
      const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (objMatch) {
        try {
          const parsed = JSON.parse(objMatch[1]);
          return { output: { ...input, parsed }, rowCount: 1 };
        } catch {
          // fall through
        }
      }

      return {
        output: { ...input, parsed: null, error: 'No valid JSON found in text' },
        logs: ['text-parser: could not extract JSON from input'],
        rowCount: 1,
      };
    }

    if (mode === 'regex') {
      const pattern = (config.pattern as string) || '';
      const flags = (config.flags as string) || '';

      if (!pattern) {
        return {
          output: { ...input, match: null, groups: null, allMatches: [], error: 'No pattern provided' },
          logs: ['text-parser: no regex pattern configured'],
          rowCount: 1,
        };
      }

      try {
        const re = new RegExp(pattern, flags);
        const firstMatch = re.exec(text);
        const match = firstMatch ? firstMatch[0] : null;
        const groups = firstMatch?.groups ?? (firstMatch ? firstMatch.slice(1) : null);

        // Collect all matches for global flag
        let allMatches: string[] = [];
        if (flags.includes('g')) {
          const globalRe = new RegExp(pattern, flags);
          allMatches = Array.from(text.matchAll(globalRe), (m) => m[0]);
        } else if (firstMatch) {
          allMatches = [firstMatch[0]];
        }

        return {
          output: { ...input, match, groups, allMatches },
          rowCount: Array.isArray(allMatches) ? allMatches.length : 1,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: { ...input, match: null, groups: null, allMatches: [], error: message },
          logs: [`text-parser: regex error: ${message}`],
          rowCount: 1,
        };
      }
    }

    if (mode === 'split') {
      const delimiter = config.delimiter !== undefined ? String(config.delimiter) : '\n';
      const items = text.split(delimiter).filter((s) => s.trim() !== '');
      return { output: { ...input, items, count: items.length }, rowCount: items.length };
    }

    return {
      output: { ...input, error: `Unknown mode: ${mode}` },
      logs: [`text-parser: unknown mode "${mode}"`],
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Must contain the text field to parse' };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    const mode = (config.mode as string) || 'json';
    if (mode === 'json') {
      return {
        type: 'object',
        description: 'Parsed JSON data. `parsed` contains the extracted value; `error` present if parsing failed.',
      };
    }
    if (mode === 'regex') {
      return {
        type: 'object',
        description: 'Regex match results: `match` (first match), `groups` (capture groups), `allMatches` (all matches when global flag set).',
      };
    }
    if (mode === 'split') {
      return {
        type: 'object',
        description: 'Split text result: `items` (array of non-empty strings), `count` (number of items).',
      };
    }
    return { type: 'object', description: 'Text parser output' };
  },
};

export const textParserDef: NodeDefinition = {
  type: 'text-parser',
  label: 'Text Parser',
  category: 'core',
  description: 'Extract structured data from text: JSON extraction, regex matching, or text splitting.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: "'json', 'regex', or 'split'" },
      inputField: { type: 'string', description: 'Field name in input to parse (default: response)' },
      pattern: { type: 'string', description: 'Regex pattern (regex mode)' },
      flags: { type: 'string', description: 'Regex flags (regex mode)' },
      delimiter: { type: 'string', description: 'Split delimiter (split mode, default: newline)' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'json', inputField: 'response', pattern: '', flags: '', delimiter: '\n' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Parsed' }],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'How to parse the text',
      options: [
        { value: 'json', label: 'Extract JSON' },
        { value: 'regex', label: 'Regex match' },
        { value: 'split', label: 'Split by delimiter' },
      ],
    },
    {
      key: 'inputField',
      label: 'Input Field',
      type: 'template-textarea',
      placeholder: 'response',
      description: 'Field name on the input object to parse',
    },
    {
      key: 'pattern',
      label: 'Pattern',
      type: 'text',
      description: 'Regular expression to match against the text',
      visibleWhen: { key: 'mode', equals: 'regex' },
    },
    {
      key: 'flags',
      label: 'Flags',
      type: 'text',
      placeholder: 'gi',
      advancedOnly: true,
      description: 'Regex flags (e.g. `g` for global, `i` for case-insensitive)',
      visibleWhen: { key: 'mode', equals: 'regex' },
    },
    {
      key: 'delimiter',
      label: 'Delimiter',
      type: 'text',
      placeholder: '\\n',
      description: 'Use \\n for newline',
      visibleWhen: { key: 'mode', equals: 'split' },
    },
  ],
  llmDescription:
    'Use after LLM Call to extract structured data. JSON mode finds JSON in markdown code blocks, raw JSON, or embedded objects. Essential for converting LLM text to structured data.',
  llmExamples: [
    { mode: 'json', inputField: 'response' },
    { mode: 'regex', inputField: 'response', pattern: 'score:\\s*(\\d+)' },
  ],
};
