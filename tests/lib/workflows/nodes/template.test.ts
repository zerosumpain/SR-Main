import { describe, it, expect } from 'vitest';
import { interpolateTemplate, interpolateTemplateStrict } from '$lib/workflows/nodes/template';

describe('interpolateTemplate', () => {
  it('resolves known paths', () => {
    expect(interpolateTemplate('Hello {{input.name}}', { name: 'World' })).toBe('Hello World');
  });

  it('returns empty string for unknown paths (legacy mode)', () => {
    expect(interpolateTemplate('Hello {{input.missing}}', {})).toBe('Hello ');
  });

  it('resolves nested paths', () => {
    expect(interpolateTemplate('{{input.a.b}}', { a: { b: 'deep' } })).toBe('deep');
  });

  it('JSON-serialises non-string values', () => {
    expect(interpolateTemplate('{{input.data}}', { data: { x: 1 } })).toBe('{"x":1}');
  });

  it('replaces nested dot-path', () => {
    expect(interpolateTemplate('{{input.user.email}}', { user: { email: 'a@b.com' } })).toBe('a@b.com');
  });

  it('serialises array values as JSON', () => {
    expect(interpolateTemplate('{{input.items}}', { items: [1, 2] })).toBe('[1,2]');
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

describe('interpolateTemplateStrict', () => {
  it('returns result and empty missingPaths when all resolved', () => {
    const { result, missingPaths } = interpolateTemplateStrict(
      'Hello {{input.name}}',
      { name: 'World' },
    );
    expect(result).toBe('Hello World');
    expect(missingPaths).toEqual([]);
  });

  it('collects missing paths', () => {
    const { result, missingPaths } = interpolateTemplateStrict(
      '{{input.a}} and {{input.b}}',
      { a: 'found' },
    );
    expect(result).toBe('found and ');
    expect(missingPaths).toEqual(['input.b']);
  });

  it('collects multiple missing paths', () => {
    const { missingPaths } = interpolateTemplateStrict(
      '{{input.x}} {{input.y}} {{input.z}}',
      {},
    );
    expect(missingPaths).toEqual(['input.x', 'input.y', 'input.z']);
  });

  it('does not flag null as missing if path exists', () => {
    const { missingPaths } = interpolateTemplateStrict(
      '{{input.val}}',
      { val: null },
    );
    // null is a valid value at an existing path — the template resolves to ''
    // but the path WAS found, so no missing path reported
    expect(missingPaths).toEqual([]);
  });
});
