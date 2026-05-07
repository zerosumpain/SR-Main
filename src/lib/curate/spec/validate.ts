import type { NodeSpec, UISchemaField, Condition } from './types';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export function validateNodeSpec(spec: NodeSpec): ValidationResult {
  const errors: string[] = [];

  if (!KEBAB_RE.test(spec.type)) errors.push(`type "${spec.type}" must be kebab-case`);
  if (!spec.label.trim()) errors.push('label must be non-empty');
  if (!spec.category.trim()) errors.push('category must be non-empty');
  if (!spec.description.trim()) errors.push('description must be non-empty');
  if (!spec.executorBody.trim()) errors.push('executorBody must be non-empty');

  // Walk uiSchema fields and verify each key exists in configSchema.properties.
  const props = (spec.configSchema as { properties?: Record<string, unknown> }).properties ?? {};
  const fieldKeysInUI = collectUiKeys(spec.uiSchema.sections.flatMap((s) => s.fields));
  for (const key of fieldKeysInUI) {
    if (!(key in props)) errors.push(`uiSchema field "${key}" is not in configSchema.properties`);
  }

  // Walk conditions and confirm referenced fields exist somewhere.
  const allKeys = new Set(Object.keys(props));
  for (const section of spec.uiSchema.sections) {
    if (section.showWhen) checkCondition(section.showWhen, allKeys, errors);
    for (const field of section.fields) {
      if (field.showWhen) checkCondition(field.showWhen, allKeys, errors);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function collectUiKeys(fields: UISchemaField[]): string[] {
  return fields.map((f) => f.key);
}

function checkCondition(c: Condition, knownKeys: Set<string>, errors: string[]): void {
  if (c.kind === 'and' || c.kind === 'or') {
    for (const sub of c.conditions) checkCondition(sub, knownKeys, errors);
    return;
  }
  if (!knownKeys.has(c.field)) errors.push(`condition references unknown field "${c.field}"`);
}
