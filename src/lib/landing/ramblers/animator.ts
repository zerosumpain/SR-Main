// Turns "he is now doing X" into a pose each frame: eases from one pose into
// the next, inserts a three-quarter turn between side and front views, blinks
// at irregular intervals, and runs the springs that make his hair and scarf
// trail behind him. One per resident. Pure apart from the random source.

import { blend, pose, type Face, type Mode, type Pose, type View } from './rig';

type Pair = [number, number];

export interface AnimInput {
  mode: Mode;
  view: View;
  /** Seconds into the mode's animation. */
  t: number;
  /** Distance walked, for the foot-locked gait. */
  dist: number;
  /** Speed forward in art units per second, for hair and scarf. */
  speed: number;
  /** A face the mood puts on whatever he is doing, if any. */
  face?: Face | null;
  /** Eyes towards the visitor's pointer, -1 to 1. */
  look?: number;
}

/** Physical moves are timed by the climbing code; blending them would cut corners. */
const CRISP = new Set<Mode>(['jump', 'land', 'fall', 'wall', 'mantle', 'aim', 'rope', 'hop']);
const SETTLE = new Set<Mode>(['sofa', 'tv', 'tea', 'eat', 'study', 'meditate', 'lookout', 'stargaze', 'plant']);
/** Faces a mood may override; an activity's own expression wins over the rest. */
const PLAIN = new Set<Face>(['neutral', 'strain']);
const TURN = 0.12;

export class Animator {
  pose: Pose | null = null;
  hairTip: Pair = [0, 0];
  /** Scarf tail points, art units from his feet, side view. */
  scarf: Pair[] = [
    [-6, -27],
    [-8, -26],
    [-10, -25],
    [-12, -24],
  ];
  private from: Pose | null = null;
  private k = 1;
  private dur = 0.25;
  private turnLeft = 0;
  private turnPose: Pose | null = null;
  private mode: Mode | null = null;
  private view: View | null = null;
  private clock = 0;
  private blinkAt = 2;
  private blinkUntil = 0;
  private hairV: Pair = [0, 0];

  constructor(private readonly random: () => number = Math.random) {}

  step(dt: number, i: AnimInput): Pose {
    this.clock += dt;
    if (i.mode !== this.mode || i.view !== this.view) {
      const turning = this.pose && this.view && i.view !== this.view && (i.view === 'front' || this.view === 'front');
      if (turning) {
        // Three-quarter frame, built from whichever end is front on.
        const front = i.view === 'front' ? pose(i.mode, 0, 'front') : this.pose!;
        this.turnPose = { ...front, view: 'front', yaw: 0.5 };
        this.turnLeft = TURN;
        this.from = null;
      } else {
        this.from = this.pose;
      }
      this.k = 0;
      this.dur = CRISP.has(i.mode) || (this.mode && CRISP.has(this.mode)) ? 0.06 : i.mode === 'sleep' || i.mode === 'nap' ? 0.6 : SETTLE.has(i.mode) || (this.mode && SETTLE.has(this.mode)) ? 0.4 : 0.25;
      this.mode = i.mode;
      this.view = i.view;
    }
    const target = pose(i.mode, i.t, i.view, { dist: i.dist, look: i.look });
    if (i.face && PLAIN.has(target.face)) target.face = i.face;
    if (this.clock > this.blinkAt) {
      this.blinkUntil = this.clock + 0.12;
      // About fifteen blinks a minute, irregularly.
      this.blinkAt = this.clock + 2 + this.random() * 4;
    }
    if (this.clock < this.blinkUntil && target.face === 'neutral') target.face = 'blink';
    let out: Pose;
    if (this.turnLeft > 0) {
      this.turnLeft -= dt;
      out = this.turnPose!;
    } else {
      this.k = Math.min(1, this.k + dt / this.dur);
      out = blend(this.from, target, this.k * this.k * (3 - 2 * this.k));
    }
    this.springs(dt, out, i.speed);
    this.pose = out;
    return out;
  }

  private springs(dt: number, p: Pose, speed: number) {
    if (dt <= 0) return;
    // The hair tuft: a damped spring pushed back by his speed and by jumps.
    const wind = -(speed / 12) - (p.lift > 2 ? 0.5 : 0);
    const h = this.hairTip;
    const v = this.hairV;
    v[0] += ((wind * 0.6 - h[0]) * 40 - v[0] * 8) * dt;
    v[1] += ((Math.min(1.2, Math.abs(wind) * 0.2) - h[1]) * 40 - v[1] * 8) * dt;
    h[0] = Math.max(-1.6, Math.min(1.2, h[0] + v[0] * dt));
    h[1] = Math.max(-1, Math.min(1.5, h[1] + v[1] * dt));
    if (p.view !== 'side') return;
    // The scarf: each link eases towards a hang angle set by his speed, the
    // lower links lagging more, so it swings and then settles.
    const lean = (p.lean * Math.PI) / 180;
    const anchor: Pair = [Math.sin(lean) * 11 - 3, -p.hipY - Math.cos(lean) * 11];
    const theta = ((25 + Math.min(1, Math.abs(speed) / 50) * 55 + (p.lift > 2 ? 25 : 0)) * Math.PI) / 180;
    const wob = speed ? Math.sin(this.clock * (Math.abs(speed) > 30 ? 14 : 8)) * 0.35 : 0;
    this.scarf = this.scarf.map((q, n) => {
      const a = theta + wob * (n + 1) * 0.25;
      const tx = anchor[0] - Math.sin(a) * 2.6 * (n + 1);
      const ty = anchor[1] + Math.cos(a) * 2.6 * (n + 1);
      const k = Math.min(1, dt * (14 - n * 3));
      return [q[0] + (tx - q[0]) * k, q[1] + (ty - q[1]) * k];
    });
  }
}
