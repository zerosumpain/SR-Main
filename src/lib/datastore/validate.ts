// $lib/datastore/validate.ts
//
// Optional per-collection JSON-Schema validation. `ajv` is NOT a dependency of
// this repo (checked against package.json — see Decision Log D5), so this is a
// deliberate minimal subset validator covering the keywords a jsonb record
// realistically uses: type, required, properties (recursive), enum,
// minimum/maximum, pattern, items. Unknown keywords are tolerated (ignored) so a
// richer schema authored elsewhere never hard-fails a save.

type Schema = Record<string, unknown>;

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/** JSON-Schema `type` name for a runtime value (jsonb-aware: array/null ≠ object). */
function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'string') return 'string';
  if (t === 'object') return 'object';
  return t; // undefined / function — should not occur in jsonb
}

function typeMatches(value: unknown, expected: string): boolean {
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return jsonType(value) === expected;
}

function isPlainSchema(schema: unknown): schema is Schema {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema);
}

function walk(value: unknown, schema: Schema, path: string, errors: string[]): void {
  const at = path || '(root)';

  // type — may be a single string or an array of allowed types
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, String(t)))) {
      errors.push(`${at}: expected type ${types.join('|')}, got ${jsonType(value)}`);
      return; // further keyword checks are meaningless once the type is wrong
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (!ok) errors.push(`${at}: value not in enum`);
  }

  // number bounds
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${at}: ${value} < minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${at}: ${value} > maximum ${schema.maximum}`);
    }
  }

  // string pattern
  if (typeof value === 'string' && typeof schema.pattern === 'string') {
    let re: RegExp | null = null;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      re = null; // invalid pattern in the schema — tolerate, don't crash
    }
    if (re && !re.test(value)) errors.push(`${at}: does not match pattern ${schema.pattern}`);
  }

  // object: required + properties
  if (jsonType(value) === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(String(req) in obj)) errors.push(`${at}: missing required field "${req}"`);
      }
    }
    if (isPlainSchema(schema.properties)) {
      for (const [prop, sub] of Object.entries(schema.properties)) {
        if (prop in obj && isPlainSchema(sub)) {
          walk(obj[prop], sub, path ? `${path}.${prop}` : prop, errors);
        }
      }
    }
  }

  // array: items
  if (Array.isArray(value) && isPlainSchema(schema.items)) {
    value.forEach((el, i) => walk(el, schema.items as Schema, `${at}[${i}]`, errors));
  }
}

/**
 * Validate `data` against a JSON-Schema subset. A null/empty schema is treated
 * as always-valid.
 */
export function validateAgainstSchema(
  data: unknown,
  schema: object | null | undefined,
): ValidationResult {
  if (!schema || !isPlainSchema(schema) || Object.keys(schema).length === 0) {
    return { ok: true };
  }
  const errors: string[] = [];
  walk(data, schema as Schema, '', errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
