import { describe, expect, it } from 'vitest';
import { FRONT_MODES, GAITS, car, figure, gait, pose, render, stride, type Mode, type View } from './rig';

const ALL: Mode[] = ['idle', 'look', 'walk', 'run', 'lookout', 'stargaze', 'study', 'think', 'sleep', 'nap', 'skip', 'pushup', 'fall', 'hop', 'land', 'wave', 'jump', 'wall', 'mantle', 'aim', 'rope', 'dig', 'plant', 'roll', 'tv', 'sofa', 'tea', 'eat', 'meditate', 'cycle', 'puddle', 'fan', 'yawn', 'stressed', 'anxious', 'mad', 'surprised', 'fidget', 'shiver', 'celebrate', 'umbrella'];
const lowest = (mode: Mode, t: number, view: View = 'side') => Math.max(...figure(mode, t, 1, view).px.map(([, y]) => y));
const DEG = Math.PI / 180;

describe('figure', () => {
  it('stands on the floor (outline under his shoes) through walking, running and standing', () => {
    for (const mode of ['idle', 'walk', 'think', 'wave'] as const) for (let t = 0; t < 2; t += 0.05) expect(lowest(mode, t), `${mode} at ${t.toFixed(2)}`).toBe(1);
    for (const mode of FRONT_MODES.filter((m) => !['yawn', 'surprised', 'celebrate', 'mad', 'meditate'].includes(m))) expect(lowest(mode, 0.5, 'front'), mode).toBe(1);
  });

  it('rests his hands and feet on the floor during push-ups', () => {
    for (let t = 0; t < 3; t += 0.1) expect(lowest('pushup', t)).toBe(1);
  });

  it('is thirty-nine pixels tall standing, outline included', () => {
    const f = figure('idle', 0, 1);
    expect(Math.max(...f.px.map(([, y]) => y)) - f.top + 1).toBe(39);
  });

  it('draws every mode in every view it has without throwing, outlined', () => {
    for (const mode of ALL)
      for (const view of ['side', 'front'] as View[]) {
        const f = figure(mode, 0.7, -1, view);
        expect(f.px.length, `${mode} ${view}`).toBeGreaterThan(100);
        expect(f.px.some(([, , c]) => c === '#24170c')).toBe(true);
      }
  });

  it('closes the outline: no body pixel touches empty space', () => {
    for (const mode of ['walk', 'think', 'mad'] as Mode[]) {
      const f = figure(mode, 0.3, 1, 'front');
      const at = new Set(f.px.map(([x, y]) => `${x},${y}`));
      for (const [x, y, c] of f.px) if (c !== '#24170c') for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(at.has(`${x + a},${y + b}`)).toBe(true);
    }
  });

  it('faces the other way when mirrored', () => {
    const right = figure('walk', 0, 1);
    const left = figure('walk', 0, -1);
    expect(Math.sign(right.head[0])).toBe(-Math.sign(left.head[0]) || 0);
  });

  it('shows his face front on only for the modes that want it', () => {
    expect(pose('think', 0, 'front').view).toBe('front');
    expect(pose('tea', 0, 'front').view).toBe('side');
    expect(pose('rope', 0, 'side').view).toBe('back');
  });
});

describe('gait', () => {
  // Foot position relative to the hip, from the pose's own angles.
  const foot = (l: [number, number]) => 7 * Math.sin(l[0] * DEG) + 6 * Math.sin(l[1] * DEG);

  for (const kind of ['walk', 'run'] as const)
    it(`keeps a planted foot still on the floor while he ${kind}s`, () => {
      const step = 0.05;
      for (let d = 0; d < stride(kind) * 3; d += step) {
        const a = gait(kind, d);
        const b = gait(kind, d + step);
        a.feet.forEach((f, i) => {
          if (!f.stance || !b.feet[i].stance) return;
          // The body moved `step` forward, so the foot must move `step` back relative to it.
          const moved = foot(b.legs[i]) - foot(a.legs[i]);
          expect(moved + step).toBeCloseTo(0, 6);
        });
      }
    });

  it('walks at a believable cadence', () => {
    // Steps a minute at his page speed of 34px/s, at 1.5px per art pixel.
    const perMinute = ((34 / 1.5) / stride('walk')) * 2 * 60;
    expect(perMinute).toBeGreaterThan(100);
    expect(perMinute).toBeLessThan(140);
    expect(GAITS.run.duty).toBeLessThan(0.5);
  });
});

describe('render', () => {
  it('holds the umbrella up in place of whatever the arm was doing', () => {
    const p = pose('walk', 0.3);
    expect(render(p, 1, { umbrella: true }).hand[1]).toBeLessThan(render(p, 1).hand[1]);
  });
});

describe('car', () => {
  it('sits its wheels on the road', () => {
    expect(Math.max(...car(1, 0, false, null).map(([, y]) => y))).toBe(0);
  });
});
