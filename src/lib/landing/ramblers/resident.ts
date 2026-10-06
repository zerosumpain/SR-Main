// What the rambler is doing and where he is: an activity picker on top of a
// small step machine (walk, climb, drop, drive). Pure apart from the random
// source, which tests replace. The overlay calls `update` each frame and reads
// the public fields to draw him.

import type { Mode } from './rig';
import { clampTo, route, type Floor, type Link, type Spot, type World } from './world';

export type Activity = 'wander' | 'run' | 'lookout' | 'study' | 'think' | 'workout' | 'drive' | 'sleep';

type Step =
  | { type: 'go'; x: number; gait: 'walk' | 'run' }
  | { type: 'link'; link: Link }
  | { type: 'land' }
  | { type: 'do'; act: Mode | 'workout'; dur: number }
  | { type: 'wave' }
  | { type: 'enter' }
  | { type: 'drive'; x: number }
  | { type: 'exit' };

type Running = Step & { t: number; stage: number; vy: number };

const WEIGHTS: Record<Activity, number> = {
  wander: 3,
  run: 1.4,
  lookout: 1.4,
  study: 1.4,
  think: 1.4,
  workout: 1.4,
  drive: 1,
  sleep: 1,
};

const SPOT_FOR: Partial<Record<Activity, Spot>> = {
  lookout: 'lookout',
  study: 'desk',
  think: 'think',
  workout: 'gym',
  sleep: 'bed',
  drive: 'garage',
};

const SPEED = { walk: 34, run: 82, climb: 30, drive: 120 };

export class Resident {
  x = 0;
  y = 0;
  dir: 1 | -1 = 1;
  mode: Mode = 'idle';
  /** Animation clock: advances only while a pose is moving. */
  animT = 0;
  /** Seconds into the current activity's settled part, and its length. */
  actT = 0;
  actDur = 0;
  activity: Activity = 'wander';
  floor: Floor | null = null;
  inCar = false;
  car: { floor: Floor; x: number; dir: 1 | -1 } | null = null;
  say: string | null = null;
  private steps: Step[] = [];
  private cur: Running | null = null;
  private world: World | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  /** Adopt a (re)built world, keeping him on the floor he was on where possible. */
  setWorld(w: World, opts: { asleep?: boolean } = {}) {
    const prevKeys = this.floor?.keys ?? null;
    this.world = w;
    const garage = w.spots.garage;
    if (garage) this.car = { floor: garage.floor, x: this.car && this.car.floor.keys[0] === garage.floor.keys[0] ? clampTo(w, this.car.x, garage.floor) : garage.x, dir: this.car?.dir ?? -1 };
    else this.car = null;
    const same = prevKeys && w.floors.find((f) => f.keys.some((k) => prevKeys.includes(k)));
    if (opts.asleep) {
      const bed = w.spots.bed ?? { floor: this.lowest(), x: 0 };
      this.place(bed.floor, bed.x || bed.floor.x1 + 40);
      this.cur = null;
      this.activity = 'sleep';
      this.steps = [{ type: 'do', act: 'sleep', dur: Infinity }];
      return;
    }
    const keepActivity = this.floor !== null;
    this.place(same || w.floors[0], this.x || w.floors[0].x1 + 40);
    this.inCar = false;
    this.say = null;
    this.cur = null;
    this.steps = [];
    if (keepActivity) this.start(this.activity === 'drive' ? 'wander' : this.activity);
  }

  /** Wave at a visitor, if he is somewhere he can stop. */
  greet() {
    const c = this.cur;
    if (!c || this.inCar || (c.type !== 'go' && c.type !== 'do')) return;
    this.steps.unshift(c.type === 'do' ? { type: 'do', act: c.act, dur: Math.max(1, c.dur - c.t) } : { type: 'go', x: c.x, gait: c.gait });
    this.cur = { type: 'wave', t: 0, stage: 0, vy: 0 };
  }

  start(activity: Activity) {
    const w = this.world;
    if (!w || !this.floor) return;
    this.activity = activity;
    this.say = null;
    if (this.inCar && this.car) {
      // Interrupted mid-drive: he parks where he is and gets out.
      this.car.x = this.x;
      this.inCar = false;
    }
    const spot = SPOT_FOR[activity] ? w.spots[SPOT_FOR[activity]!] : undefined;
    let floor: Floor;
    let x: number;
    if (activity === 'drive' && this.car) {
      floor = this.car.floor;
      x = this.car.x;
    } else if (spot) {
      floor = spot.floor;
      x = spot.x;
    } else if (activity === 'sleep') {
      // No bed on this page (the writing strip only appears with posts): he
      // naps on the ground floor rather than wherever he happens to be.
      floor = this.lowest();
      x = floor.x1 + 80;
    } else {
      const choices = w.floors.filter((f) => f !== this.floor || activity === 'wander');
      floor = choices[Math.floor(this.random() * choices.length)] ?? this.floor;
      x = floor.x1 + w.margin + this.random() * Math.max(0, floor.x2 - floor.x1 - 2 * w.margin);
    }
    let links = route(w, this.floor, this.x, floor);
    if (!links) {
      links = [];
      floor = this.floor;
      x = clampTo(w, x, floor);
    }
    // A long trip is a jog: at walking pace, crossing a wide page takes most
    // of a minute and he would spend his life commuting.
    let distance = 0;
    let from = this.x;
    for (const link of links) {
      distance += Math.abs(link.fx - from) + Math.abs(link.to.y - link.from.y);
      from = link.tx;
    }
    distance += Math.abs(x - from);
    const gait = activity === 'run' || distance > 700 ? 'run' : 'walk';
    this.steps = [];
    for (const link of links) this.steps.push({ type: 'go', x: link.fx, gait }, { type: 'link', link });
    this.steps.push({ type: 'go', x: clampTo(w, x, floor), gait });
    const r = (a: number, b: number) => a + this.random() * (b - a);
    switch (activity) {
      case 'wander':
      case 'run':
        this.steps.push({ type: 'do', act: 'idle', dur: r(1.2, 2.6) });
        break;
      case 'drive': {
        if (!this.car) break;
        const f = this.car.floor;
        const far = this.car.x - f.x1 > f.x2 - this.car.x ? f.x1 + 30 : f.x2 - 30;
        this.steps.push({ type: 'enter' }, { type: 'drive', x: far }, { type: 'drive', x: this.car.x }, { type: 'exit' }, { type: 'do', act: 'idle', dur: 1 });
        break;
      }
      case 'workout':
        this.steps.push({ type: 'do', act: 'workout', dur: r(9, 13) });
        break;
      case 'think':
        this.steps.push({ type: 'do', act: 'think', dur: r(6, 9) });
        break;
      case 'study':
        this.steps.push({ type: 'do', act: 'study', dur: r(8, 12) });
        break;
      case 'lookout':
        this.steps.push({ type: 'do', act: 'lookout', dur: r(5, 8) });
        break;
      case 'sleep':
        this.steps.push({ type: 'do', act: 'sleep', dur: r(10, 14) });
        break;
    }
  }

  private next() {
    const options = (Object.keys(WEIGHTS) as Activity[]).filter((a) => a === 'wander' || a !== this.activity);
    const total = options.reduce((s, a) => s + WEIGHTS[a], 0);
    let roll = this.random() * total;
    for (const a of options) {
      roll -= WEIGHTS[a];
      if (roll <= 0) return this.start(a);
    }
    this.start('wander');
  }

  update(dt: number) {
    if (!this.world || !this.floor) return;
    if (!this.cur) {
      if (!this.steps.length) this.next();
      const s = this.steps.shift();
      if (!s) return;
      this.cur = { ...s, t: 0, stage: 0, vy: 0 };
      if (s.type === 'do') {
        this.actT = 0;
        this.actDur = s.dur;
      }
    }
    const c = this.cur;
    c.t += dt;
    const done = () => (this.cur = null);
    const walkTo = (x: number, gait: 'walk' | 'run') => {
      const dx = x - this.x;
      if (Math.abs(dx) < 0.8) {
        this.x = x;
        return true;
      }
      this.dir = dx > 0 ? 1 : -1;
      this.x += Math.sign(dx) * Math.min(Math.abs(dx), SPEED[gait] * dt);
      this.mode = gait;
      this.animT += dt;
      return false;
    };
    switch (c.type) {
      case 'go':
        this.y = this.floor.y;
        if (walkTo(c.x, c.gait)) {
          this.mode = 'idle';
          done();
        }
        break;
      case 'link': {
        const l = c.link;
        if (l.type === 'ladder') {
          if (c.stage === 0) {
            if (walkTo(l.ladder.x, 'walk')) c.stage = 1;
            break;
          }
          this.mode = 'climb';
          this.x = l.ladder.x;
          this.animT += dt;
          const up = l.to.y < l.from.y;
          this.y += (up ? -1 : 1) * SPEED.climb * dt;
          if (up ? this.y <= l.to.y : this.y >= l.to.y) {
            this.y = l.to.y;
            this.floor = l.to;
            this.mode = 'idle';
            done();
          }
        } else {
          if (c.stage === 0) {
            c.vy = -40;
            c.stage = 1;
          }
          c.vy += 900 * dt;
          this.y += c.vy * dt;
          this.dir = l.side;
          this.x += (l.tx - this.x) * Math.min(1, dt * 5);
          this.mode = 'fall';
          if (this.y >= l.to.y) {
            this.y = l.to.y;
            this.floor = l.to;
            this.steps.unshift({ type: 'land' });
            done();
          }
        }
        break;
      }
      case 'land':
        this.mode = 'land';
        if (c.t > 0.18) done();
        break;
      case 'do':
        this.y = this.floor.y;
        this.actT = c.t;
        this.animT += dt;
        this.mode = c.act === 'workout' ? (Math.floor(c.t / 4.5) % 2 ? 'pushup' : 'skip') : c.act;
        if (c.act === 'idle' && c.stage === 0 && c.t > c.dur / 2) {
          c.stage = 1;
          this.dir = this.dir === 1 ? -1 : 1;
        }
        if (c.t >= c.dur) done();
        break;
      case 'wave':
        this.mode = 'wave';
        this.animT += dt;
        this.say = 'hi!';
        if (c.t > 1.4) {
          this.say = null;
          done();
        }
        break;
      case 'enter':
      case 'exit':
        this.mode = 'idle';
        if (c.t > 0.35) {
          this.inCar = c.type === 'enter';
          done();
        }
        break;
      case 'drive': {
        if (!this.car) return done();
        this.inCar = true;
        const dx = c.x - this.x;
        if (Math.abs(dx) < 0.8) {
          this.x = c.x;
          done();
          break;
        }
        this.dir = dx > 0 ? 1 : -1;
        // Ease in and out over the first and last forty pixels.
        const speed = SPEED.drive * Math.min(1, 0.25 + Math.min(c.t, Math.abs(dx) / 40));
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        this.car.x = this.x;
        this.car.dir = this.dir;
        this.animT += dt;
        break;
      }
    }
  }

  private place(f: Floor, x: number) {
    this.floor = f;
    this.x = this.world ? clampTo(this.world, x, f) : x;
    this.y = f.y;
  }

  private lowest() {
    return this.world!.floors.reduce((a, b) => (b.y > a.y ? b : a));
  }
}
