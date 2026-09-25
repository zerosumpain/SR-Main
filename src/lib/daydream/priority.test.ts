import { describe, it, expect } from 'vitest';
import { TONE_RANK, noteTone } from './priority';

describe('tone ordering', () => {
  it('puts broken before waiting-on-you before merely true', () => {
    expect(TONE_RANK.urgent).toBeLessThan(TONE_RANK.action);
    expect(TONE_RANK.action).toBeLessThan(TONE_RANK.watch);
    expect(TONE_RANK.watch).toBeLessThan(TONE_RANK.good);
    expect(TONE_RANK.steady).toBeLessThan(TONE_RANK.quiet);
  });

});

describe('noteTone', () => {
  it('asks for a verdict until one is given, then files it', () => {
    expect(noteTone({ verdict: null })).toBe('action');
    expect(noteTone({ verdict: 'useful' })).toBe('good');
    expect(noteTone({ verdict: 'not_useful' })).toBe('quiet');
    expect(noteTone({ verdict: 'never_kind' })).toBe('quiet');
  });
});
