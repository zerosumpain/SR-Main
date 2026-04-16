/**
 * Safe expression evaluator for workflow nodes.
 *
 * Blocks dangerous tokens (require, import, process, global, etc.) before
 * passing the expression to `new Function`, preventing server-side RCE via
 * LLM-generated or user-supplied workflow expressions.
 */

const BLOCKED_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bimport\b/,
  /\bprocess\b/,
  /\bglobal(This)?\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bchild_process\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bfs\b/,
  /\bmodule\b/,
  /\bconstructor\b/,
];

export class UnsafeExpressionError extends Error {
  constructor(matched: string) {
    super(`Blocked unsafe expression token: ${matched}`);
    this.name = 'UnsafeExpressionError';
  }
}

/**
 * Validates that an expression does not contain tokens that could escape
 * the `new Function` sandbox and access Node.js internals.
 *
 * Throws `UnsafeExpressionError` if a blocked pattern is found.
 */
export function validateExpression(expression: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    const match = expression.match(pattern);
    if (match) {
      throw new UnsafeExpressionError(match[0]);
    }
  }
}

/**
 * Build a Function from an expression after safety validation.
 * The returned function receives the listed `argNames` as parameters.
 */
export function safeFunction(argNames: string[], body: string): Function {
  validateExpression(body);
  return new Function(...argNames, body);
}
