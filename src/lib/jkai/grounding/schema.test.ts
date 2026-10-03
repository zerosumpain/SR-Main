import { describe, it, expect } from 'vitest';
import { dropEmptyOptionalArguments, validateArguments } from './schema';
it('rejects malformed input before effects and preserves valid scope', () => {
  const schema = { type: 'object', properties: { id: { type: 'string' }, mode: { enum: ['read'] } }, required: ['id'], additionalProperties: false };
  expect(validateArguments(schema, { id: 2 }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', mode: 'delete' }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, {}).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', guessed: true }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', mode: 'read' })).toEqual([]);
});

describe('dropEmptyOptionalArguments', () => {
  const schema = {
    type: 'object',
    properties: { title: { type: 'string' }, createdAfter: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } },
    required: ['title'],
  };

  it('drops optional empty strings, as Codex sends for arguments it has nothing for', () => {
    expect(dropEmptyOptionalArguments(schema, { title: 'x', createdAfter: '', query: '  ', limit: 0 })).toEqual({ title: 'x', limit: 0 });
  });

  it('keeps a required empty string, so validation can still refuse it', () => {
    expect(dropEmptyOptionalArguments(schema, { title: '' })).toEqual({ title: '' });
  });

  it('returns the same object when there is nothing to drop', () => {
    const args = { title: 'x', query: 'q' };
    expect(dropEmptyOptionalArguments(schema, args)).toBe(args);
  });
});
