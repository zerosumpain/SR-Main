import { it, expect } from 'vitest';
import { validateArguments } from './schema';
it('rejects malformed input before effects and preserves valid scope', () => {
  const schema = { type: 'object', properties: { id: { type: 'string' }, mode: { enum: ['read'] } }, required: ['id'], additionalProperties: false };
  expect(validateArguments(schema, { id: 2 }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', mode: 'delete' }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, {}).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', guessed: true }).length).toBeGreaterThan(0);
  expect(validateArguments(schema, { id: 'x', mode: 'read' })).toEqual([]);
});
