// What the rambler is doing and where he is: an activity picker on top of a
// small step machine (walk, climb, drop, drive). Pure apart from the random
// source, which tests replace. The overlay calls `update` each frame and reads
// the public fields to draw him.

import type { Mode } from './rig';
import { clampTo, route, type Floor, type Link, type Spot, type World } from './world';

type Climb = Exclude<Link, { type: 'drop' }>;

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

type Running = Step & { t: number; stage: number; vy: number; x0: number; y0: number };

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

const SPEED = { walk: 34, run: 82, climb: 26, abseil: 80, drive: 120 };

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
  /** A grappling rope while one is out: its line, hook end and loose end. */
  rope: { x: number; top: number; bottom: number } | null = null;
  private steps: Step[] = [];
  private cur: Running | null = null;
  private world: World | null = null;

  /** His height on screen, for knowing when his hands reach a ledge. */
  private readonly height: number;

  constructor(
    private readonly random: () => number = Math.random,
    scale = 2,
  ) {
    this.height = 18 * scale;
  }

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
    this.rope = null;
    this.cur = null;
    this.steps = [];
    if (keepActivity) this.start(this.activity === 'drive' ? 'wander' : this.activity);
  }

  /** Wave at a visitor, if he is somewhere he can stop. */
  greet() {
    const c = this.cur;
    if (!c || this.inCar || (c.type !== 'go' && c.type !== 'do')) return;
    this.steps.unshift(c.type === 'do' ? { type: 'do', act: c.act, dur: Math.max(1, c.dur - c.t) } : { type: 'go', x: c.x, gait: c.gait });
    this.cur = { type: 'wave', t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
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
      this.cur = { ...s, t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
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
        if (l.type !== 'drop') {
          this.climb(c, l, dt, walkTo, done);
          break;
        }
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

  /** One climb between floors: a jump, a wall, or a rope, up or down. */
  private climb(c: Running, l: Climb, dt: number, walkTo: (x: number, gait: 'walk' | 'run') => boolean, done: () => void) {
    const h = this.height;
    const stage = (n: number) => {
      c.stage = n;
      c.t = 0;
      c.x0 = this.x;
      c.y0 = this.y;
    };
    const u = (seconds: number) => Math.min(1, c.t / seconds);
    // A tall climb goes quicker, so none takes more than a few seconds.
    const span = Math.abs(l.to.y - l.from.y);
    const climbSpeed = Math.max(SPEED.climb, span / 5);
    const abseilSpeed = Math.max(SPEED.abseil, span / 3);
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const arrive = () => {
      this.floor = l.to;
      this.y = l.to.y;
    };
    // Hands on the ledge, then a pull up and over onto the floor above.
    const mantle = () => {
      const k = u(0.4);
      this.mode = 'mantle';
      this.x = lerp(c.x0, l.tx, k);
      this.y = lerp(c.y0, l.to.y, k);
      return k >= 1;
    };
    if (c.stage === 0) {
      if (walkTo(l.fx, 'walk')) stage(1);
      return;
    }
    if (l.type === 'jump') {
      if (c.stage === 1) {
        this.mode = 'land';
        if (c.t > 0.15) stage(2);
        return;
      }
      const k = u(0.45);
      if (l.tx !== c.x0) this.dir = l.tx > c.x0 ? 1 : -1;
      this.mode = 'jump';
      this.x = lerp(c.x0, l.tx, k);
      this.y = lerp(c.y0, l.to.y, k) - Math.sin(Math.PI * k) * (l.up ? 16 : 8);
      if (k >= 1) {
        arrive();
        this.steps.unshift({ type: 'land' });
        done();
      }
      return;
    }
    if (l.type === 'wall') {
      this.dir = l.face;
      if (l.up) {
        if (c.stage === 1) {
          // The wall stops short of the floor: jump to grab its foot first.
          if (l.wallBottom >= c.y0 - 2) return stage(2);
          const k = u(0.3);
          this.mode = 'jump';
          this.y = lerp(c.y0, l.wallBottom, k);
          if (k >= 1) stage(2);
        } else if (c.stage === 2) {
          this.mode = 'wall';
          this.animT += dt;
          this.x = l.ax;
          this.y -= climbSpeed * dt;
          if (this.y <= l.to.y + h * 0.5) stage(3);
        } else if (mantle()) {
          arrive();
          done();
        }
        return;
      }
      if (c.stage === 1) {
        // Over the edge, feet first.
        const k = u(0.4);
        this.mode = 'mantle';
        this.x = lerp(c.x0, l.ax, k);
        this.y = lerp(c.y0, l.from.y + h * 0.5, k);
        if (k >= 1) stage(2);
      } else if (c.stage === 2) {
        this.mode = 'wall';
        this.animT += dt;
        this.y += climbSpeed * 1.2 * dt;
        if (this.y >= Math.min(l.wallBottom, l.to.y)) stage(3);
      } else {
        c.vy += 900 * dt;
        this.y += c.vy * dt;
        this.mode = 'fall';
        if (this.y >= l.to.y) {
          arrive();
          this.steps.unshift({ type: 'land' });
          done();
        }
      }
      return;
    }
    // Rope.
    if (l.up) {
      switch (c.stage) {
        case 1:
          this.mode = 'aim';
          if (c.t > 0.35) {
            this.rope = { x: l.ax, top: this.y - h, bottom: this.y - h };
            stage(2);
          }
          break;
        case 2: {
          // The hook flies up, paying out rope behind it.
          const rope = this.rope!;
          rope.top = Math.max(l.to.y, rope.top - 900 * dt);
          if (rope.top <= l.to.y) {
            rope.bottom = l.from.y;
            stage(3);
          }
          break;
        }
        case 3:
          // A tug to check it holds.
          this.mode = c.t < 0.12 ? 'land' : 'aim';
          if (c.t > 0.3) stage(4);
          break;
        case 4:
          this.mode = 'rope';
          this.animT += dt;
          this.x = l.ax;
          this.y -= climbSpeed * dt;
          if (this.y <= l.to.y + h * 0.5) stage(5);
          break;
        case 5:
          if (mantle()) {
            arrive();
            stage(6);
          }
          break;
        default: {
          // Reel it in.
          this.mode = 'idle';
          const k = u(0.35);
          if (this.rope) this.rope.bottom = lerp(l.from.y, l.to.y, k);
          if (k >= 1) {
            this.rope = null;
            done();
          }
        }
      }
      return;
    }
    switch (c.stage) {
      case 1:
        // Fix the rope at the edge and throw the loose end down.
        this.mode = 'land';
        if (c.t > 0.3) {
          this.rope = { x: l.ax, top: l.from.y, bottom: l.to.y };
          stage(2);
        }
        break;
      case 2: {
        const k = u(0.3);
        this.mode = 'rope';
        this.x = lerp(c.x0, l.ax, k);
        this.y = lerp(c.y0, l.from.y + h * 0.4, k);
        if (k >= 1) stage(3);
        break;
      }
      case 3:
        this.mode = 'rope';
        this.animT += dt * 0.5;
        this.y += abseilSpeed * dt;
        if (this.y >= l.to.y) {
          arrive();
          stage(4);
        }
        break;
      default: {
        // Flick it free from below; it falls and is gathered up.
        this.mode = 'idle';
        const k = u(0.3);
        if (this.rope) this.rope.top = lerp(l.from.y, l.to.y, k);
        if (k >= 1) {
          this.rope = null;
          done();
        }
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
