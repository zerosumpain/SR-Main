import { describe, it, expect } from 'vitest';
import { noteTone } from './priority';

describe('noteTone', () => {
  it('asks for a verdict until one is given, then files it', () => {
    expect(noteTone({ verdict: null })).toBe('action');
    expect(noteTone({ verdict: 'useful' })).toBe('good');
    expect(noteTone({ verdict: 'not_useful' })).toBe('quiet');
    expect(noteTone({ verdict: 'never_kind' })).toBe('quiet');
  });
});
