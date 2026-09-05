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
