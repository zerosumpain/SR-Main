// src/lib/workflows/expressions.ts
//
// The ONE template-expression resolver. The engine applies it to a node's config
// before the executor runs (engine-node-runner.resolveNodeConfig), so every node
// gets the same syntax for free. Pure and isomorphic: the verifier and the canvas
// autocomplete import it too.
//
//   {{input.a.b}}  {{input.items[0].title}}  {{input.items.0}}
//   {{nodes.<id-or-label-slug>.field}}   (`.output.` is optional: nodes.x.output.field)
//   {{trigger.field}}                    (the run's trigger payload; `.output.` optional)
//   {{state.KEY}}  {{today}}  {{now}}
//   {{x ?? 'fallback'}}   {{x | upper}}   {{x | join(', ')}}   {{x | date('YYYY-MM-DD')}}
//
// A config value that is exactly one expression keeps its type (array, object,
// number) when the field is declared non-string; otherwise values embed as text,
// objects as JSON. Tokens outside these namespaces ({{ states('x') }} for Home
// Assistant, {{keyword}} playbook slots) are left verbatim. Nothing throws: an
// unknown reference becomes '' and a warning. No eval — a fixed filter set only.

import type { WorkflowNodeDef } from './types';

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const WHOLE_RE = /^\{\{\s*([^}]+?)\s*\}\}$/;
const NAMESPACES = new Set(['input', 'nodes', 'trigger', 'state']);

export const EXPRESSION_SYNTAX =
  '{{input.field}} (merged upstream data), {{nodes.<node-id-or-label-slug>.field}} (one upstream node\'s output, e.g. {{nodes.fetch-news.items[0].title}}), ' +
  '{{trigger.field}} (the run\'s trigger payload), {{state.KEY}}, {{today}}, {{now}}. Index with [0] or .0; default with {{input.name ?? \'friend\'}}; ' +
  'filters: json, upper, lower, trim, length, join(\', \'), first, last, date(\'YYYY-MM-DD\'). A field that is exactly one {{...}} keeps its type (array/object/number). No JS, no {{#each}}/{% %}.';

export interface ExprScope {
  input?: Record<string, unknown>;
  /** Look up a node's output by id or label slug (undefined = not run / unknown). */
  nodes?: (ref: string) => Record<string, unknown> | undefined;
  trigger?: Record<string, unknown>;
  state?: Map<string, unknown>;
  now?: Date;
}

export interface TemplateWarning {
  token: string;
  reason: string;
}

/** Canvas + engine share this: "Fetch News!" → "fetch-news". */
export function nodeSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Format a date as en-GB long, Europe/London — e.g. "Wednesday 16 July 2026". */
export function formatToday(now: Date): string {
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'Europe/London' }).format(now);
  return `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })} ${part({ year: 'numeric' })}`;
}

/** null/undefined → '', string as-is, else JSON — the embedding rule since day one. */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Split on a separator outside quotes and parentheses. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let quote = '', depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) { out.push(s.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim());
}

function literal(s: string): { ok: boolean; value?: unknown } {
  if (/^(['"]).*\1$/s.test(s)) return { ok: true, value: s.slice(1, -1) };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { ok: true, value: Number(s) };
  return { ok: false };
}

/** "a.b[0]['c d'].1" → ['a','b','0','c d','1']. Segments may hold spaces/hyphens (legacy keys). */
export function parsePath(ref: string): string[] {
  const parts: string[] = [];
  const re = /\[\s*(?:'([^']*)'|"([^"]*)"|([^\]]*?))\s*\]|([^.[\]]+)/g;
  for (const m of ref.matchAll(re)) parts.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return parts;
}

/** Walk a path, tracking presence: a null leaf is present, a missing key is not. */
export function resolvePathWithPresence(obj: unknown, path: string | string[]): { exists: boolean; value: unknown } {
  let current = obj;
  for (const part of typeof path === 'string' ? parsePath(path) : path) {
    if (current === null || typeof current !== 'object' || !(part in (current as object))) return { exists: false, value: undefined };
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

/** `output.` is optional on nodes.X and trigger: try the literal path, then without it. */
function withOptionalOutput(root: unknown, rest: string[]) {
  const direct = resolvePathWithPresence(root, rest);
  if (direct.exists || rest[0] !== 'output') return direct;
  return resolvePathWithPresence(root, rest.slice(1));
}

function resolveRef(ref: string, scope: ExprScope): { exists: boolean; value: unknown } {
  const now = scope.now ?? new Date();
  if (ref === 'today') return { exists: true, value: formatToday(now) };
  if (ref === 'now') return { exists: true, value: now.toISOString() };
  const [root, ...rest] = parsePath(ref);
  if (root === 'input') return resolvePathWithPresence(scope.input ?? {}, rest);
  if (root === 'trigger') return withOptionalOutput(scope.trigger ?? {}, rest);
  if (root === 'nodes') {
    const out = rest.length ? scope.nodes?.(rest[0]) : undefined;
    return out ? withOptionalOutput(out, rest.slice(1)) : { exists: false, value: undefined };
  }
  // state: an exact key (even one containing dots) wins over a dot-path.
  const store = scope.state ?? new Map();
  const key = ref.slice('state.'.length);
  if (store.has(key)) return { exists: true, value: store.get(key) };
  if (!store.has(rest[0])) return { exists: false, value: undefined };
  return resolvePathWithPresence(store.get(rest[0]), rest.slice(1));
}

function formatDate(value: unknown, fmt: string): string {
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  const map: Record<string, string> = { YYYY: parts.year, MM: parts.month, DD: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

const FILTERS: Record<string, (v: unknown, arg: unknown) => unknown> = {
  json: (v) => JSON.stringify(v ?? null),
  upper: (v) => toText(v).toUpperCase(),
  lower: (v) => toText(v).toLowerCase(),
  trim: (v) => toText(v).trim(),
  length: (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0),
  join: (v, sep) => (Array.isArray(v) ? v.map(toText).join(sep === undefined ? ', ' : String(sep)) : toText(v)),
  first: (v) => (Array.isArray(v) || typeof v === 'string' ? v[0] : v),
  last: (v) => (Array.isArray(v) || typeof v === 'string' ? v[v.length - 1] : v),
  date: (v, fmt) => formatDate(v, fmt === undefined ? 'YYYY-MM-DD' : String(fmt)),
};

/** The references (not literals) an expression reads — for lint and the missing-path report. */
export function expressionRefs(inner: string): string[] {
  if (inner.includes('||')) return [];
  return splitTop(inner, '??').map((alt) => splitTop(alt, '|')[0]).filter((op) => !literal(op).ok);
}

/** True when a `{{...}}` inner token belongs to us (else it is left verbatim). */
export function isOwnExpression(inner: string): boolean {
  const refs = expressionRefs(inner.includes('||') ? inner.split('||')[0] : inner);
  return refs.length > 0 && refs.every((r) => r === 'today' || r === 'now' || NAMESPACES.has(parsePath(r)[0] ?? ''));
}

export interface EvalResult { value: unknown; missing: string[]; warning?: string }

/** Evaluate one expression's inner text. Never throws. */
export function evaluateExpression(inner: string, scope: ExprScope): EvalResult {
  if (inner.includes('||')) return { value: undefined, missing: [inner], warning: `{{${inner}}} uses ||, which templates do not support — use ?? for a fallback. It substitutes to an empty string.` };
  const missing: string[] = [];
  let value: unknown;
  let warning: string | undefined;
  for (const alt of splitTop(inner, '??')) {
    const [operand, ...filters] = splitTop(alt, '|');
    const lit = literal(operand);
    let found = lit.ok;
    value = lit.value;
    if (!lit.ok) {
      const r = resolveRef(operand, scope);
      found = r.exists;
      value = r.value;
      if (!found) missing.push(operand);
    }
    for (const f of filters) {
      const m = /^(\w+)\s*(?:\((.*)\))?$/s.exec(f);
      const fn = m && FILTERS[m[1]];
      if (!fn) { warning = `{{${inner}}} uses an unknown filter "${f}" (supported: ${Object.keys(FILTERS).join(', ')}).`; continue; }
      const arg = m[2] === undefined || m[2].trim() === '' ? undefined : literal(m[2].trim()).value;
      if (value !== undefined || m[1] === 'json') value = fn(value, arg);
    }
    if (value !== undefined && value !== null) return { value, missing: [], warning };
  }
  const allMissing = missing.length === splitTop(inner, '??').length;
  return { value, missing: allMissing ? missing : [], warning };
}

export interface ResolveResult {
  config: Record<string, unknown>;
  warnings: TemplateWarning[];
  /** resolved text → the references it could not find (for the strict helpers). */
  missingByText: Map<string, string[]>;
}

/**
 * Resolve every string in a config into a NEW structure (never mutates).
 * `rawKeys` (code/expression fields) are copied untouched; `typedKeys` are the
 * top-level fields whose declared type is not string — only a top-level value
 * there that is one lone expression keeps its type, so an executor that
 * String()s a field (or a nested param) still sees exactly the text it always did.
 */
export function resolveConfig(
  config: Record<string, unknown>,
  scope: ExprScope,
  opts: { rawKeys?: readonly string[]; typedKeys?: ReadonlySet<string> } = {},
): ResolveResult {
  const warnings: TemplateWarning[] = [];
  const seen = new Set<string>();
  const missingByText = new Map<string, string[]>();
  const warn = (token: string, reason: string) => {
    if (!seen.has(token)) { seen.add(token); warnings.push({ token, reason }); }
  };
  const evalToken = (inner: string, sink: string[]): unknown => {
    const r = evaluateExpression(inner, scope);
    if (r.warning) warn(inner, r.warning);
    for (const m of r.missing) {
      sink.push(m);
      warn(inner, `{{${inner}}} references ${m.startsWith('nodes.') ? 'a node or field that has not produced output' : m.startsWith('state.') ? 'an unknown workflow state key' : "a field not present in this node's input"} — it substitutes to an empty string.`);
    }
    return r.value;
  };
  const resolveString = (str: string, typed: boolean): unknown => {
    const sink: string[] = [];
    const whole = WHOLE_RE.exec(str);
    let out: unknown;
    if (whole && typed && isOwnExpression(whole[1])) {
      out = evalToken(whole[1], sink) ?? '';
    } else {
      out = str.replace(TOKEN_RE, (match: string, inner: string) => {
        if (/^[#/!]/.test(inner) || inner.includes('%')) return match;
        if (!isOwnExpression(inner)) {
          warn(inner, `{{${inner}}} is not a supported template variable and will not be substituted (supported: {{input.*}}, {{nodes.<id>.*}}, {{trigger.*}}, {{state.KEY}}, {{today}}, {{now}}).`);
          return match;
        }
        return toText(evalToken(inner, sink));
      });
    }
    if (typeof out === 'string' && sink.length) missingByText.set(out, [...(missingByText.get(out) ?? []), ...sink]);
    return out;
  };
  const walk = (val: unknown, typed = false): unknown => {
    if (typeof val === 'string') return val.includes('{{') ? resolveString(val, typed) : val;
    if (Array.isArray(val)) return val.map((v) => walk(v));
    if (val !== null && typeof val === 'object') {
      return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, walk(v)]));
    }
    return val;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = opts.rawKeys?.includes(k) ? v : walk(v, opts.typedKeys?.has(k));
  }
  return { config: out, warnings, missingByText };
}

/** Extract the trimmed inner text of every `{{...}}` token in a string. */
export function extractTemplateTokens(str: string): string[] {
  return [...str.matchAll(TOKEN_RE)].map((m) => m[1].trim());
}

export type TemplateTokenKind = 'input' | 'nodes' | 'trigger' | 'state' | 'today' | 'now' | 'block' | 'unknown';

/** Classify a `{{...}}` inner token by the namespace of its first reference. */
export function classifyTemplateToken(inner: string): TemplateTokenKind {
  const t = inner.trim();
  if (/^[#/!]/.test(t) || t.includes('%')) return 'block';
  if (!isOwnExpression(t)) return 'unknown';
  const ref = expressionRefs(t.split('||')[0])[0];
  return (ref === 'today' || ref === 'now' ? ref : parsePath(ref)[0]) as TemplateTokenKind;
}

/** True if any string in the workflow's node configs references `{{state...}}`. */
export function workflowUsesStateTemplates(nodes: WorkflowNodeDef[]): boolean {
  return nodes.some((n) => /\{\{[^}]*\bstate[.\s}]/.test(JSON.stringify(n.config ?? {})));
}

/** Plain path read without presence tracking; an empty path reads nothing. */
export function getPath(obj: unknown, path: string): unknown {
  return path ? resolvePathWithPresence(obj, path).value : undefined;
}
