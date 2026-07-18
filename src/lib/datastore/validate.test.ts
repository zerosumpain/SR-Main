import { describe, it, expect } from 'vitest';
import { validateAgainstSchema } from './validate';

describe('validateAgainstSchema — subset semantics', () => {
  it('accepts a matching object against type + required + properties', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, age: { type: 'number' } },
    };
    const r = validateAgainstSchema({ name: 'Ada', age: 36 }, schema);
    expect(r.ok).toBe(true);
  });

  it('flags a missing required field with the field name', () => {
    const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    const r = validateAgainstSchema({ age: 1 }, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('name');
  });

  it('checks primitive types (string/number/boolean/array/null/object)', () => {
    expect(validateAgainstSchema('hi', { type: 'string' }).ok).toBe(true);
    expect(validateAgainstSchema(5, { type: 'number' }).ok).toBe(true);
    expect(validateAgainstSchema(true, { type: 'boolean' }).ok).toBe(true);
    expect(validateAgainstSchema([], { type: 'array' }).ok).toBe(true);
    expect(validateAgainstSchema(null, { type: 'null' }).ok).toBe(true);
    expect(validateAgainstSchema('nope', { type: 'number' }).ok).toBe(false);
    // arrays and null must not read as "object"
    expect(validateAgainstSchema([], { type: 'object' }).ok).toBe(false);
    expect(validateAgainstSchema(null, { type: 'object' }).ok).toBe(false);
  });

  it('validates nested properties recursively', () => {
    const schema = {
      type: 'object',
      properties: { inner: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } } },
    };
    expect(validateAgainstSchema({ inner: { x: 1 } }, schema).ok).toBe(true);
    expect(validateAgainstSchema({ inner: { x: 'no' } }, schema).ok).toBe(false);
  });

  it('enforces enum membership', () => {
    const schema = { enum: ['open', 'closed'] };
    expect(validateAgainstSchema('open', schema).ok).toBe(true);
    expect(validateAgainstSchema('other', schema).ok).toBe(false);
  });

  it('enforces minimum/maximum on numbers', () => {
    const schema = { type: 'number', minimum: 0, maximum: 10 };
    expect(validateAgainstSchema(5, schema).ok).toBe(true);
    expect(validateAgainstSchema(-1, schema).ok).toBe(false);
    expect(validateAgainstSchema(11, schema).ok).toBe(false);
  });

  it('enforces string pattern', () => {
    const schema = { type: 'string', pattern: '^[a-z]+$' };
    expect(validateAgainstSchema('abc', schema).ok).toBe(true);
    expect(validateAgainstSchema('ABC', schema).ok).toBe(false);
  });

  it('validates array items', () => {
    const schema = { type: 'array', items: { type: 'number' } };
    expect(validateAgainstSchema([1, 2, 3], schema).ok).toBe(true);
    expect(validateAgainstSchema([1, 'two'], schema).ok).toBe(false);
  });

  it('tolerates unknown keywords (e.g. format, description, $id)', () => {
    const schema = {
      type: 'object',
      description: 'ignored',
      $id: 'x',
      properties: { email: { type: 'string', format: 'email', description: 'ignored' } },
    };
    expect(validateAgainstSchema({ email: 'a@b.c' }, schema).ok).toBe(true);
  });

  it('treats a null/empty schema as always-valid', () => {
    expect(validateAgainstSchema({ anything: true }, null as unknown as object).ok).toBe(true);
    expect(validateAgainstSchema({ anything: true }, {}).ok).toBe(true);
  });
});
