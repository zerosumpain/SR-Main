// src/lib/workflows/state-templates.ts
//
// Engine-level template resolution for the `{{state.*}}`, `{{today}}` and
// `{{now}}` namespaces, plus a loud unknown-variable scanner.
//
// These are pure, dependency-light helpers (no DB import) so they can be unit
// tested directly and shared between the runtime engine (engine.ts) and the
// author-time verifier (orchestrator/verify.ts).
//
// Namespace split (deliberately disjoint so there is no double-resolution):
//   {{state.KEY}} / {{today}} / {{now}}  → resolved HERE, by the engine, from a
//                                          per-run store snapshot, into a config
//                                          COPY handed to the executor.
//   {{input.*}}                          → left untouched here; each executor
//                                          resolves it against its merged input.

import type { WorkflowNodeDef } from './types';
import { resolvePathWithPresence } from './nodes/template';

/** Matches a single `{{ ... }}` token, capturing the (untrimmed) inner text. */
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface StateResolveContext {
  /** key → stored (already JSON-parsed) value, from `loadStoreSnapshot`. */
  store: Map<string, unknown>;
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  now?: Date;
}

/** Format a date as en-GB long, Europe/London — e.g. "Wednesday 16 July 2026". */
export function formatToday(now: Date): string {
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'Europe/London' }).format(now);
  const weekday = part({ weekday: 'long' });
  const day = part({ day: 'numeric' });
  const month = part({ month: 'long' });
  const year = part({ year: 'numeric' });
  return `${weekday} ${day} ${month} ${year}`;
}

/** Mirror `nodes/template.ts` value semantics: null/undefined → '', string as-is, else JSON. */
function stringifyStoreValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Resolve a `state.` key-path against the store snapshot.
 * Exact-key match first (so a store key literally named "a.b" wins); otherwise
 * the first segment is the store key and the remainder is a dot-path into the
 * stored JSON value.
 */
function resolveStateValue(
  keyPath: string,
  store: Map<string, unknown>,
): { found: boolean; value: unknown } {
  if (!keyPath) return { found: false, value: undefined };
  if (store.has(keyPath)) return { found: true, value: store.get(keyPath) };
  const dot = keyPath.indexOf('.');
  if (dot === -1) return { found: false, value: undefined };
  const firstKey = keyPath.slice(0, dot);
  const rest = keyPath.slice(dot + 1);
  if (!store.has(firstKey)) return { found: false, value: undefined };
  const { exists, value } = resolvePathWithPresence(store.get(firstKey), rest);
  return { found: exists, value };
}

/**
 * Resolve `{{state.*}}` / `{{today}}` / `{{now}}` in a single string. Leaves
 * `{{input.*}}` and unknown namespaces verbatim (executors / the warning scan
 * handle those). Unresolvable `state` keys are left verbatim and recorded.
 */
export function resolveStateTemplatesString(
  str: string,
  ctx: StateResolveContext,
): { result: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const now = ctx.now ?? new Date();
  const result = str.replace(TOKEN_RE, (match: string, rawInner: string) => {
    const inner = rawInner.trim();
    if (inner === 'today') return formatToday(now);
    if (inner === 'now') return now.toISOString();
    if (inner === 'state' || inner.startsWith('state.')) {
      const keyPath = inner === 'state' ? '' : inner.slice('state.'.length);
      const resolved = resolveStateValue(keyPath, ctx.store);
      if (!resolved.found) {
        unresolved.push(inner);
        return match; // leave the token in place so the warning scan sees it
      }
      return stringifyStoreValue(resolved.value);
    }
    // {{input.*}} and anything else: not ours to resolve.
    return match;
  });
  return { result, unresolved };
}

/**
 * Deep-walk a node config (strings, nested objects, arrays) and resolve engine
 * template namespaces into a NEW structure. Never mutates the input — the
 * returned config is the copy handed to the executor.
 */
export function resolveStateTemplatesDeep(
  config: Record<string, unknown>,
  ctx: StateResolveContext,
): { config: Record<string, unknown>; unresolved: string[] } {
  const unresolved: string[] = [];
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') {
      const r = resolveStateTemplatesString(val, ctx);
      if (r.unresolved.length) unresolved.push(...r.unresolved);
      return r.result;
    }
    if (Array.isArray(val)) return val.map(walk);
    if (val !== null && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return val;
  };
  const resolved = walk(config) as Record<string, unknown>;
  return { config: resolved, unresolved };
}

export type TemplateTokenKind = 'input' | 'state' | 'today' | 'now' | 'block' | 'unknown';

/** Classify a `{{...}}` inner token into its namespace. */
export function classifyTemplateToken(inner: string): TemplateTokenKind {
  const t = inner.trim();
  // Jinja/Handlebars block or helper syntax — flagged separately as an error.
  if (/^[#/!]/.test(t) || t.includes('%')) return 'block';
  if (t === 'today') return 'today';
  if (t === 'now') return 'now';
  if (t === 'input' || t.startsWith('input.')) return 'input';
  if (t === 'state' || t.startsWith('state.')) return 'state';
  return 'unknown';
}

/** Extract the trimmed inner text of every `{{...}}` token in a string. */
export function extractTemplateTokens(str: string): string[] {
  const out: string[] = [];
  for (const m of str.matchAll(TOKEN_RE)) out.push(m[1].trim());
  return out;
}

export interface TemplateWarning {
  token: string;
  reason: string;
}

/**
 * Scan a (already state-resolved) config for `{{...}}` tokens that will NOT be
 * substituted at runtime:
 *  - `{{input.PATH}}` whose PATH is absent from this node's merged input,
 *  - `{{state.KEY}}` still present (i.e. the store had no such key),
 *  - any unknown namespace ({{trigger.output.x}}, {{env.X}}, …).
 * Block/helper syntax is skipped (the verifier reports it as a hard error).
 */
export function scanUnknownTemplateVars(
  config: Record<string, unknown>,
  mergedInput: Record<string, unknown>,
): TemplateWarning[] {
  const warnings: TemplateWarning[] = [];
  const seen = new Set<string>();

  const check = (str: string) => {
    for (const inner of extractTemplateTokens(str)) {
      if (seen.has(inner)) continue;
      const kind = classifyTemplateToken(inner);
      if (kind === 'block' || kind === 'today' || kind === 'now') continue;
      if (kind === 'input') {
        const path = inner === 'input' ? '' : inner.slice('input.'.length);
        const present = path ? resolvePathWithPresence(mergedInput, path).exists : true;
        if (!present) {
          seen.add(inner);
          warnings.push({
            token: inner,
            reason: `{{${inner}}} references a field not present in this node's input — it will substitute to an empty string.`,
          });
        }
        continue;
      }
      if (kind === 'state') {
        seen.add(inner);
        warnings.push({
          token: inner,
          reason: `{{${inner}}} is an unknown workflow state key — nothing wrote it, so it will not be substituted.`,
        });
        continue;
      }
      // unknown namespace
      seen.add(inner);
      warnings.push({
        token: inner,
        reason: `{{${inner}}} is not a supported template variable and will not be substituted (supported: {{input.*}}, {{state.KEY}}, {{today}}, {{now}}).`,
      });
    }
  };

  const walk = (val: unknown) => {
    if (typeof val === 'string') check(val);
    else if (Array.isArray(val)) val.forEach(walk);
    else if (val !== null && typeof val === 'object') Object.values(val).forEach(walk);
  };
  walk(config);
  return warnings;
}

/** True if any string in the workflow's node configs references `{{state...}}`. */
export function workflowUsesStateTemplates(nodes: WorkflowNodeDef[]): boolean {
  const hasStateToken = (val: unknown): boolean => {
    if (typeof val === 'string') return /\{\{\s*state[.\s}]/.test(val);
    if (Array.isArray(val)) return val.some(hasStateToken);
    if (val !== null && typeof val === 'object') return Object.values(val).some(hasStateToken);
    return false;
  };
  return nodes.some((n) => hasStateToken(n.config));
}
