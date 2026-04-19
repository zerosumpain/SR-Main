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

/**
 * Strict interpolation that tracks unresolved paths.
 * A path is "missing" when the key doesn't exist in the input tree.
 * null values are treated as present-but-empty (not missing).
 */
export function interpolateTemplateStrict(
  template: string,
  input: Record<string, unknown>,
): { result: string; missingPaths: string[] } {
  const missingPaths: string[] = [];
  const result = template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const resolved = resolvePathWithPresence(input, path);
    if (!resolved.exists) {
      missingPaths.push(`input.${path}`);
      return '';
    }
    const value = resolved.value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
  return { result, missingPaths };
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

function resolvePathWithPresence(
  obj: Record<string, unknown>,
  path: string,
): { exists: boolean; value: unknown } {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { exists: false, value: undefined };
    }
    const rec = current as Record<string, unknown>;
    if (!(parts[i] in rec)) {
      return { exists: false, value: undefined };
    }
    current = rec[parts[i]];
  }
  return { exists: true, value: current };
}
