// src/lib/workflows/nodes/template.ts
//
// Per-executor interpolation, now a thin shim over `../expressions`. Inside an
// engine run the config has ALREADY been resolved once (engine-node-runner
// marks the input), so these return the text untouched — resolving again would
// substitute into upstream DATA that merely contains braces. Callers outside the
// engine (node-call tool, llm-agent tool nodes, the scraper endpoint) still get
// `{{input.*}}` resolved here, with the same syntax.
import { resolveConfig, toText } from '../expressions';

/** input object → (resolved text → references it could not find). */
const engineResolved = new WeakMap<object, Map<string, string[]>>();

/** Called by the engine once it has resolved a node's config against `input`. */
export function markEngineResolved(input: object, missingByText: Map<string, string[]>): void {
  engineResolved.set(input, missingByText);
}

/**
 * Strict interpolation that tracks unresolved references. A reference is
 * "missing" when a key doesn't exist; a null value is present-but-empty.
 */
export function interpolateTemplateStrict(
  template: unknown,
  input: Record<string, unknown>,
): { result: string; missingPaths: string[] } {
  const text = toText(template);
  const done = engineResolved.get(input);
  if (done) return { result: text, missingPaths: done.get(text) ?? [] };
  if (!text.includes('{{')) return { result: text, missingPaths: [] };
  const r = resolveConfig({ t: text }, { input });
  return { result: r.config.t as string, missingPaths: r.missingByText.get(r.config.t as string) ?? [] };
}

/** Interpolate `{{input.path}}` (and friends); unknown paths become ''. */
export function interpolateTemplate(template: unknown, input: Record<string, unknown>): string {
  return interpolateTemplateStrict(template, input).result;
}
