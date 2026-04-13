// src/lib/workflows/nodes/template.ts

/**
 * Interpolate {{input.field.path}} references in a template string.
 * Resolves dot-paths into the input object. Non-string values are JSON-serialised.
 * Unknown paths produce empty string.
 */
export function interpolateTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(input, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
