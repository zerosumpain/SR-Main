import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map<string, ValidateFunction>();
export interface ArgumentIssue { path: string; message: string; expected?: unknown }
/** Validate without coercion or removal: handlers never receive guessed arguments. */
export function validateArguments(schema: object, args: unknown): ArgumentIssue[] {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    try { validate = ajv.compile(schema); } catch {
      return [{ path: '/', message: 'Tool schema is invalid; repair its definition before invoking.' }];
    }
    if (validators.size > 1000) validators.clear();
    validators.set(key, validate);
  }
  if (validate(args)) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => ({
    path: e.instancePath || '/', message: e.message ?? e.keyword, expected: e.params,
  }));
}

/**
 * Drop optional top-level arguments the caller sent as an empty string.
 *
 * Codex fills every property of a tool's schema, optional or not, and sends the
 * ones it has nothing for as `""`. A handler that asks "was this given?" with
 * `=== undefined` then sees a value, and a date or id parser refuses it:
 * `apple_calendar_list` failed every such call in the 30 days to 2026-10-03
 * ("createdAfter is required."), on a question that never mentioned creation
 * dates. An empty optional string carries no intent, so it is treated as not
 * given — nothing is guessed or filled in. Required arguments are left alone,
 * so an empty required string still fails validation as it should.
 */
export function dropEmptyOptionalArguments(schema: object, args: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(
    Array.isArray((schema as { required?: unknown }).required) ? ((schema as { required: unknown[] }).required as unknown[]) : [],
  );
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value !== 'string' || value.trim() !== '' || required.has(key)) continue;
    out ??= { ...args };
    delete out[key];
  }
  return out ?? args;
}
