import { describe, it, expect } from 'vitest';
import { staticScan } from './authored-scan';

describe('staticScan — computed constructor access', () => {
  it.each([
    ["dotted", "return ''.constructor.constructor('return 1')()"],
    ['optional chain', 'return x?.constructor'],
    ['quoted bracket', "return ''['constructor']"],
    ['template bracket', 'return x[`constructor`]'],
    ['concatenated name', "const f = x['constr' + 'uctor']; return f"],
    ['template-built name', 'return x[`${a}${b}`]'],
    ['char-code name', 'return x[String.fromCharCode(99, 111)]'],
    ['joined name', "return x[['con', 'structor'].join('')]"],
    ['prototype walk', 'return Object.getPrototypeOf(async function () {})'],
    ['escaped string', "return x['\\x63onstructor']"],
  ])('refuses %s', (_label, code) => {
    expect(staticScan(code).ok).toBe(false);
  });

  // Shapes real production handlers use (F1 data has `Constructors`; entity
  // decoding uses fromCharCode). Refusing these would unregister working tools.
  it.each([
    ['a variable called constructor', 'for (const constructor of rows) out.push(constructor.name); return { success: true, data: out }'],
    ['an object key called constructor', 'return { success: true, data: { constructor: r?.Constructor?.name } }'],
    ['entity decoding', 'return { success: true, data: s.replace(/&#(\\d+);/g, (_, c) => String.fromCharCode(Number(c))) }'],
    ['array literal with concatenation', "return { success: true, data: ['- ' + item.name] }"],
    ['index arithmetic', 'return { success: true, data: row[key] + arr[i + 1] }'],
  ])('allows %s', (_label, code) => {
    expect(staticScan(code)).toEqual({ ok: true, violations: [] });
  });
});
