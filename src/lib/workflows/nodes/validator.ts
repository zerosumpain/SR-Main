import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { safeFunction, UnsafeExpressionError } from './safe-eval';

function checkType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'any') return true;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === expectedType;
}

/**
 * Convert a SchemaFieldRow[] (from the schema-builder field type) into the
 * { properties, required } JSON-Schema shape the validator already consumes.
 */
function rowsToSchema(rows: unknown): { type: 'object'; properties: Record<string, { type: string }>; required: string[] } {
  if (!Array.isArray(rows)) return { type: 'object', properties: {}, required: [] };
  const properties: Record<string, { type: string }> = {};
  const required: string[] = [];
  for (const r of rows as { name: string; type: string; required: boolean }[]) {
    if (!r || typeof r !== 'object' || !r.name) continue;
    properties[r.name] = { type: r.type };
    if (r.required) required.push(r.name);
  }
  return { type: 'object', properties, required };
}

function validateSchema(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
): NodeResult {
  const rawSchema = config.schema;
  let schema: JsonSchema;

  // Backwards compatibility: existing workflows store the schema as a JSON
  // string (textarea). The new UI stores it as SchemaFieldRow[]. Support both.
  if (Array.isArray(rawSchema)) {
    schema = rowsToSchema(rawSchema) as unknown as JsonSchema;
  } else {
    const schemaStr = (rawSchema as string) || '';
    try {
      schema = JSON.parse(schemaStr) as JsonSchema;
    } catch {
      return {
        output: { ...input, valid: false, errors: ['Invalid JSON schema'] },
        metadata: { _selectedHandle: 'fail' },
        rowCount: 1,
      };
    }
  }

  const errors: string[] = [];

  // Check required fields
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in input) || input[field] === undefined || input[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check property types
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in input && input[key] !== undefined) {
        const propType = (propSchema as JsonSchema).type;
        if (propType && !checkType(input[key], propType)) {
          errors.push(`Field "${key}" expected type ${propType}, got ${Array.isArray(input[key]) ? 'array' : typeof input[key]}`);
        }
      }
    }
  }

  const valid = errors.length === 0;
  return {
    output: { ...input, valid, errors },
    metadata: { _selectedHandle: valid ? 'pass' : 'fail' },
    rowCount: 1,
  };
}

function validateExpression(
  input: Record<string, unknown>,
  config: Record<string, unknown>,
): NodeResult {
  const expression = (config.expression as string) || '';

  if (!expression.trim()) {
    return {
      output: { ...input, valid: false, errors: ['Empty expression'] },
      metadata: { _selectedHandle: 'fail' },
      rowCount: 1,
    };
  }

  let valid = false;
  const errors: string[] = [];

  try {
    const fn = safeFunction(['input'], `return !!(${expression})`);
    valid = fn(input);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Expression error: ${message}`);
    return {
      output: { ...input, valid: false, errors },
      metadata: { _selectedHandle: 'fail' },
      rowCount: 1,
    };
  }

  return {
    output: { ...input, valid, errors },
    metadata: { _selectedHandle: valid ? 'pass' : 'fail' },
    rowCount: 1,
  };
}

export const validatorExecutor: NodeExecutor = {
  type: 'validator',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as string) || 'expression';
    if (mode === 'schema') return validateSchema(input, config);
    if (mode === 'expression') return validateExpression(input, config);
    return {
      output: { ...input, valid: false, errors: ['Unknown validation mode'] },
      metadata: { _selectedHandle: 'fail' },
      rowCount: 1,
    };
  },

  getInputSchema(): JsonSchema {
    return { type: 'object', description: 'Data to validate' };
  },

  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        valid: { type: 'boolean', description: 'Whether validation passed' },
        errors: { type: 'array', description: 'List of validation error messages' },
      },
    };
  },
};

export const validatorDef: NodeDefinition = {
  type: 'validator',
  label: 'Validator',
  category: 'agentic',
  description: 'Validate data against a JSON Schema or JS expression. Routes to pass/fail outputs.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: "'schema' or 'expression'" },
      schema: { type: 'string', description: 'JSON Schema string (for schema mode)' },
      expression: { type: 'string', description: 'JS boolean expression (for expression mode)' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'expression', expression: 'true', schema: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Data' }],
  outputs: [
    { name: 'pass', type: 'any', label: 'Pass' },
    { name: 'fail', type: 'any', label: 'Fail' },
  ],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'How to validate the incoming data',
      options: [
        { value: 'expression', label: 'Expression (JS boolean)' },
        { value: 'schema', label: 'JSON Schema' },
      ],
    },
    {
      key: 'expression',
      label: 'Expression',
      type: 'template-textarea',
      placeholder: 'input.score >= 80',
      description: 'JavaScript boolean expression. Use `input.field` to reference data.',
      visibleWhen: { key: 'mode', equals: 'expression' },
    },
    {
      key: 'schema',
      label: 'Schema',
      type: 'schema-builder',
      description: 'Define the expected fields, types, and which are required.',
      visibleWhen: { key: 'mode', equals: 'schema' },
    },
  ],
  llmDescription:
    'Use to validate data quality or check LLM output structure. Place after LLM Call nodes. Routes to "pass" or "fail" — connect fail back to revision for agentic retry loops.',
  llmExamples: [
    { mode: 'expression', expression: 'input.response && input.response.length > 100' },
    { mode: 'schema', schema: '{"type":"object","required":["title","body"]}' },
  ],
};
