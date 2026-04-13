import { describe, it, expect } from 'vitest';
import { interpolateTemplate } from '$lib/workflows/nodes/template';

describe('interpolateTemplate', () => {
  it('replaces simple field reference', () => {
    expect(interpolateTemplate('Hello {{input.name}}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces nested dot-path', () => {
    expect(interpolateTemplate('{{input.user.email}}', { user: { email: 'a@b.com' } })).toBe('a@b.com');
  });

  it('serialises object values as JSON', () => {
    expect(interpolateTemplate('{{input.items}}', { items: [1, 2] })).toBe('[1,2]');
  });

  it('leaves unknown references as empty string', () => {
    expect(interpolateTemplate('{{input.missing}}', {})).toBe('');
  });

  it('leaves non-template strings unchanged', () => {
    expect(interpolateTemplate('no templates here', {})).toBe('no templates here');
  });

  it('handles multiple replacements in one string', () => {
    expect(
      interpolateTemplate('{{input.first}} {{input.last}}', { first: 'John', last: 'Kelly' })
    ).toBe('John Kelly');
  });
});
