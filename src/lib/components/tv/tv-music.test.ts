import { describe, expect, it } from 'vitest';
import { trackFor } from './tv-music';

describe('trackFor', () => {
  it('plays the menu track on the menu and the about page', () => {
    expect(trackFor('menu', null, false)).toBe('menu');
    expect(trackFor('about', 'boggle', false)).toBe('menu');
  });

  it('plays the lobby track while the party waits', () => {
    expect(trackFor('lobby', 'azul', false)).toBe('lobby');
  });

  it('plays the quick track for games against the clock and the board track for the rest', () => {
    expect(trackFor('lobby', 'snap-happy', true)).toBe('quick');
    expect(trackFor('lobby', 'biscuit-tower', true)).toBe('quick');
    expect(trackFor('lobby', 'iron-roads', true)).toBe('board');
    expect(trackFor('menu', 'quiz-night', true)).toBe('board');
  });
});
