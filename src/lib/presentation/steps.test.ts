import { describe, expect, it } from 'vitest';
import { maxStep, stepArrow } from './steps';
import type { Block } from './types';

const blocks: Block[] = [
  { type: 'headline', text: 'Always visible' },
  { type: 'prose', body: 'First reveal', step: 1 },
  { type: 'prose', body: 'Second reveal', step: 2 },
];

describe('maxStep', () => {
  it('is the highest step on the slide, 0 when nothing is staged', () => {
    expect(maxStep(blocks)).toBe(2);
    expect(maxStep([{ type: 'headline', text: 'plain' }])).toBe(0);
    expect(maxStep([])).toBe(0);
  });
});

describe('stepArrow', () => {
  it('forward on the plane axis reveals until the last step, then navigates', () => {
    expect(stepArrow('h', 'right', 0, 2)).toBe('reveal');
    expect(stepArrow('h', 'right', 1, 2)).toBe('reveal');
    expect(stepArrow('h', 'right', 2, 2)).toBeNull();
    expect(stepArrow('v', 'down', 0, 1)).toBe('reveal');
  });

  it('backward on the plane axis un-reveals before leaving the slide', () => {
    expect(stepArrow('h', 'left', 2, 2)).toBe('unreveal');
    expect(stepArrow('h', 'left', 0, 2)).toBeNull();
    expect(stepArrow('v', 'up', 1, 1)).toBe('unreveal');
  });

  it('cross-axis keys always navigate (journeys are never gated)', () => {
    expect(stepArrow('h', 'down', 0, 2)).toBeNull();
    expect(stepArrow('h', 'up', 1, 2)).toBeNull();
    expect(stepArrow('v', 'right', 0, 2)).toBeNull();
  });

  it('unstaged slides never intercept', () => {
    expect(stepArrow('h', 'right', 0, 0)).toBeNull();
  });
});
