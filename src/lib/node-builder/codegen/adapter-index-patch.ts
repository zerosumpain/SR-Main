import type { NodeSpec } from '../spec/types';
import { adapterFileName } from './adapter';

/**
 * Idempotently adds `import './<integrationType>';` to the
 * `src/lib/integrations/adapters/index.ts` barrel. The barrel is imported
 * once from `src/hooks.server.ts` so every emitted adapter registers itself
 * at server startup.
 *
 * Pure function — does not touch the filesystem. Caller passes the current
 * source (or an empty string if the file doesn't exist yet).
 */
export function patchAdapterIndex(source: string, spec: NodeSpec): string {
  if (!spec.integrationType) return source;

  const baseName = adapterFileName(spec.integrationType).replace(/\.ts$/, '');
  const importLine = `import './${baseName}';`;

  if (source.includes(importLine)) return source;

  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return (
      `// Side-effect imports for every integration adapter. Each module calls\n` +
      `// registerIntegrationAdapter() at load time. Imported once from\n` +
      `// hooks.server.ts so the registrations fire on server boot.\n` +
      `\n` +
      `${importLine}\n`
    );
  }

  // Append at the end (preserving final newline).
  const trailingNewline = source.endsWith('\n') ? '' : '\n';
  return source + trailingNewline + importLine + '\n';
}
