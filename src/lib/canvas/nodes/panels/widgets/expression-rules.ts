// Compile / decompile helpers for the rule-builder widget. Shared between
// ConditionalPanel (routes input → true/false branches) and ValidatorPanel
// (asserts that input passes a set of field rules). The compiled output is
// a single boolean JS expression that the executor evaluates with
// `new Function('input', 'return (<expr>);')`.

export type Operator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'contains'
  | 'matches'
  | 'is empty'
  | 'is not empty'
  | 'is truthy'
  | 'is falsy';

export type Rule = { field: string; op: Operator; value: string };

export const UNARY_OPS: Operator[] = ['is empty', 'is not empty', 'is truthy', 'is falsy'];

export const ALL_OPS: Operator[] = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'matches',
  'is empty',
  'is not empty',
  'is truthy',
  'is falsy',
];

export function isUnary(op: Operator): boolean {
  return UNARY_OPS.includes(op);
}

// Map a typed value string to a JS literal fragment.
// Auto-detect: number → numeric literal; "true"/"false" → boolean; else → JSON-quoted string.
export function compileValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '""';
  if (trimmed === 'true') return 'true';
  if (trimmed === 'false') return 'false';
  if (trimmed === 'null') return 'null';
  // Number detection: must parse as a finite number AND its toString must round-trip
  // (so "01" or "1abc" stay as strings).
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
    return trimmed;
  }
  return JSON.stringify(raw);
}

export function compileRule(rule: Rule): string {
  const field = rule.field.trim() || 'input.value';
  const v = rule.value;
  switch (rule.op) {
    case '==':
      return `${field} == ${compileValue(v)}`;
    case '!=':
      return `${field} != ${compileValue(v)}`;
    case '<':
      return `${field} < ${compileValue(v)}`;
    case '<=':
      return `${field} <= ${compileValue(v)}`;
    case '>':
      return `${field} > ${compileValue(v)}`;
    case '>=':
      return `${field} >= ${compileValue(v)}`;
    case 'contains':
      return `String(${field} ?? "").includes(${compileValue(v)})`;
    case 'matches':
      // Empty regex source would match everything; require a non-empty value.
      if (!v.trim()) return 'false';
      return `new RegExp(${compileValue(v)}).test(String(${field} ?? ""))`;
    case 'is empty':
      return `(${field} == null || ${field} === "" || (Array.isArray(${field}) && ${field}.length === 0))`;
    case 'is not empty':
      return `!(${field} == null || ${field} === "" || (Array.isArray(${field}) && ${field}.length === 0))`;
    case 'is truthy':
      return `!!(${field})`;
    case 'is falsy':
      return `!(${field})`;
  }
}

export function compileRules(rules: Rule[], joiner: 'AND' | 'OR'): string {
  if (rules.length === 0) return 'false';
  const parts = rules.map((r) => `(${compileRule(r)})`);
  if (parts.length === 1) return parts[0].slice(1, -1); // drop redundant outer parens
  return parts.join(joiner === 'AND' ? ' && ' : ' || ');
}

// ---- Round-trip parsing -----------------------------------------------
// Try to parse an existing expression back into a single rule. Only handles
// the simple shapes the rule builder itself emits (single rule, no joiner).
// Anything more complex → null, and the caller should fall back to advanced
// mode without trying to round-trip.

function findTopLevelOp(src: string, op: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && src.startsWith(op, i)) return i;
  }
  return -1;
}

function parseStringLiteral(src: string): string | null {
  if (src.length < 2) return null;
  const q = src[0];
  if ((q === '"' || q === "'") && src[src.length - 1] === q) {
    try { return JSON.parse(q === "'" ? `"${src.slice(1, -1).replace(/"/g, '\\"')}"` : src); }
    catch { return null; }
  }
  return null;
}

function decompileValue(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const s = parseStringLiteral(trimmed);
  if (s !== null) return s;
  return null;
}

export function tryParseSingleRule(expr: string): Rule | null {
  const src = expr.trim();
  if (!src) return null;

  // Strip a single pair of outer parens if present.
  const stripped = src.startsWith('(') && src.endsWith(')') ? src.slice(1, -1).trim() : src;

  let m: RegExpMatchArray | null;

  // is truthy: !!(field)
  m = stripped.match(/^!!\s*\((.+)\)$/);
  if (m) return { field: m[1].trim(), op: 'is truthy', value: '' };

  // is falsy: !(field)
  m = stripped.match(/^!\s*\((.+)\)$/);
  if (m && !stripped.startsWith('!!')) return { field: m[1].trim(), op: 'is falsy', value: '' };

  // contains: String(field ?? "").includes("v")
  m = stripped.match(/^String\((.+?)\s*\?\?\s*""\)\.includes\((.+)\)$/);
  if (m) {
    const v = parseStringLiteral(m[2].trim());
    if (v !== null) return { field: m[1].trim(), op: 'contains', value: v };
  }

  // matches: new RegExp("v").test(String(field ?? ""))
  m = stripped.match(/^new RegExp\((.+?)\)\.test\(String\((.+?)\s*\?\?\s*""\)\)$/);
  if (m) {
    const v = parseStringLiteral(m[1].trim());
    if (v !== null) return { field: m[2].trim(), op: 'matches', value: v };
  }

  // binary comparisons: field OP value
  // Try the longest operators first so "<=" doesn't get parsed as "<".
  const binOps: Operator[] = ['==', '!=', '<=', '>=', '<', '>'];
  for (const op of binOps) {
    const idx = findTopLevelOp(stripped, op);
    if (idx >= 0) {
      const left = stripped.slice(0, idx).trim();
      const right = stripped.slice(idx + op.length).trim();
      // Skip === / !== (we don't emit those, but be conservative):
      if (op === '==' && stripped[idx + 2] === '=') continue;
      if (op === '!=' && stripped[idx + 2] === '=') continue;
      const v = decompileValue(right);
      if (v === null) continue;
      return { field: left, op, value: v };
    }
  }

  return null;
}
