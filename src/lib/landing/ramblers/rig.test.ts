import { describe, expect, it } from 'vitest';
import { car, figure, type Mode } from './rig';

const lowest = (mode: Mode, t: number) => Math.max(...figure(mode, t, 1).px.map(([, y]) => y));

describe('figure', () => {
  it('keeps a foot on the floor through every frame of walking and running', () => {
    for (const mode of ['idle', 'walk', 'run', 'think', 'wave'] as const)
      for (let t = 0; t < 2; t += 0.05) expect(lowest(mode, t), `${mode} at ${t.toFixed(2)}`).toBe(0);
  });

  it('rests his hands and feet on the floor during push-ups', () => {
    for (let t = 0; t < 3; t += 0.1) expect(lowest('pushup', t)).toBe(0);
  });

  it('is about eighteen pixels tall standing', () => {
    expect(-figure('idle', 0, 1).top + 1).toBe(18);
  });

  it('faces the other way when mirrored', () => {
    const right = figure('idle', 0, 1);
    const left = figure('idle', 0, -1);
    expect(Math.sign(right.head[0])).toBe(-Math.sign(left.head[0]) || 0);
  });
});

describe('car', () => {
  it('sits its wheels on the road', () => {
    expect(Math.max(...car(1, 0, false, null).map(([, y]) => y))).toBe(0);
  });
});
