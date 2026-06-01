import { describe, it, expect } from 'vitest';
import {
  validateExpression,
  safeFunction,
  UnsafeExpressionError,
} from '$lib/workflows/nodes/safe-eval';

describe('validateExpression — rejects sandbox escapes', () => {
  // The headline acceptance case: the constructor-walk RCE that defeated the
  // old regex denylist via dynamic property access.
  it('rejects the constructor-walk RCE bypass', () => {
    expect(() =>
      validateExpression(
        'this["cons"+"tructor"]["cons"+"tructor"]("return process.env.HOME")()',
      ),
    ).toThrow(UnsafeExpressionError);
  });

  const escapes: Array<[string, string]> = [
    ['require()', 'return require("fs")'],
    ['process access', 'process.env.HOME'],
    ['globalThis', 'globalThis.process'],
    ['global', 'global.process'],
    ['this expression', 'this.foo'],
    ['eval call', 'eval("1+1")'],
    ['Function constructor call', 'Function("return process")()'],
    ['new Function', 'new Function("return 1")'],
    ['static .constructor', '({}).constructor'],
    ['constructor.constructor chain', '({}).constructor.constructor("return process")()'],
    ['computed banned literal', 'x["constructor"]'],
    ['computed __proto__', 'x["__proto__"]'],
    ['dynamic computed access', 'x[someKey]'],
    ['concatenated computed access', 'x["con"+"structor"]'],
    ['import() expression', 'import("fs")'],
    ['arguments', 'arguments[0]'],
    ['prototype access', 'x.prototype'],
    ['Reflect', 'Reflect.get(x, "y")'],
    ['Proxy', 'new Proxy({}, {})'],
    ['module', 'module.exports'],
    ['exports', 'exports.x'],
    ['with statement', 'with (x) { y }'],
  ];

  for (const [label, expr] of escapes) {
    it(`rejects: ${label}`, () => {
      expect(() => validateExpression(expr)).toThrow(UnsafeExpressionError);
    });
  }
});

describe('validateExpression — allows legitimate expressions', () => {
  const legit: string[] = [
    'input.value * 2 + Math.max(1,3)',
    'input.score >= 80',
    '!!(input.score >= 80)',
    'input.body.results[0].value',
    'input["someField"]',
    'input.items.length > 0',
    'return { ...input, x: 1 }',
    'return { doubled: input.value * 2 }',
    'return !!(input.count > 10)',
    'const x = input.a; return x + 1;',
    'input.a && input.b || input.c',
    'JSON.stringify(input)',
    'new Date().toISOString()',
  ];

  for (const expr of legit) {
    it(`allows: ${expr}`, () => {
      expect(() => validateExpression(expr)).not.toThrow();
    });
  }
});

describe('safeFunction', () => {
  it('builds and evaluates a safe expression body', () => {
    const fn = safeFunction(['input'], 'return input.value * 2 + Math.max(1, 3)');
    expect(fn({ value: 10 })).toBe(23);
  });

  it('validates the body before building (throws on escape)', () => {
    expect(() =>
      safeFunction(['input'], 'return this.constructor'),
    ).toThrow(UnsafeExpressionError);
  });

  it('the constructor-walk RCE never reaches new Function', () => {
    expect(() =>
      safeFunction(
        ['input'],
        'return this["cons"+"tructor"]["cons"+"tructor"]("return process.env.HOME")()',
      ),
    ).toThrow(UnsafeExpressionError);
  });

  it('supports multiple argument names', () => {
    const fn = safeFunction(['item', 'index', 'input'], 'return item + index');
    expect(fn(10, 5, {})).toBe(15);
  });
});
