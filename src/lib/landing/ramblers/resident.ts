// What the rambler is doing and where he is: an activity picker on top of a
// small step machine (walk, climb, drop, drive). The owner's day leans the
// picker (see mood.ts), and he keeps to the part of the page the visitor is
// looking at, chasing them down if they scroll away. Pure apart from the
// random source, which tests replace. The overlay calls `update` each frame
// and reads the public fields to draw him.

import { CALM, type Mood } from './mood';
import type { Mode } from './rig';
import { aside, SPECIAL, want, type Line } from './talk';
import { clampTo, route, type Floor, type Link, type Spot, type World } from './world';

type Climb = Exclude<Link, { type: 'drop' }>;

export type Activity =
  | 'wander'
  | 'run'
  | 'lookout'
  | 'study'
  | 'think'
  | 'workout'
  | 'drive'
  | 'sleep'
  | 'garden'
  | 'tv'
  | 'sofa'
  | 'stressed'
  | 'anxious'
  | 'umbrella';

type Step =
  | { type: 'go'; x: number; gait: 'walk' | 'run' }
  | { type: 'link'; link: Link }
  | { type: 'land' }
  | { type: 'do'; act: Mode | 'workout'; dur: number }
  | { type: 'wave'; text?: string }
  | { type: 'enter' }
  | { type: 'drive'; x: number }
  | { type: 'exit' }
  | { type: 'zip'; floor: Floor; x: number; fromAbove: boolean };

type Running = Step & { t: number; stage: number; vy: number; x0: number; y0: number };

const WEIGHTS: Record<Activity, number> = {
  wander: 3,
  run: 1.2,
  lookout: 1.2,
  study: 1.2,
  think: 1.2,
  workout: 1.2,
  drive: 0.9,
  sleep: 0.9,
  garden: 1.3,
  tv: 1.1,
  sofa: 1.1,
  stressed: 0.4,
  anxious: 0.4,
  umbrella: 0.4,
};

const SPOT_FOR: Partial<Record<Activity, Spot>> = {
  lookout: 'lookout',
  study: 'desk',
  think: 'think',
  workout: 'gym',
  sleep: 'bed',
  drive: 'garage',
};

/** Activities tied to one place on the page: no point if it is out of view. */
const FIXED: Activity[] = ['lookout', 'drive'];

const SPEED = { walk: 34, run: 82, climb: 26, abseil: 80, drive: 120, zip: 260 };

/** Seconds out of view (with the page still) before he comes looking. */
const MISSED = 1.2;
const FLOWERS = ['#d2402a', '#e8b21f', '#8a5bb0', '#f2ede4', '#e86aa0'];

export interface Flower {
  key: number;
  x: number;
  colour: string;
  /** Session clock when planted: it grows over the next few seconds. */
  born: number;
}

export class Resident {
  x = 0;
  y = 0;
  dir: 1 | -1 = 1;
  mode: Mode = 'idle';
  /** Animation clock: advances only while a pose is moving. */
  animT = 0;
  /** Seconds since this resident started; flowers grow against it. */
  clock = 0;
  /** Seconds into the current activity's settled part, and its length. */
  actT = 0;
  actDur = 0;
  activity: Activity = 'wander';
  floor: Floor | null = null;
  inCar = false;
  car: { floor: Floor; x: number; dir: 1 | -1 } | null = null;
  /** What he is saying or thinking, until the session clock passes `until`. */
  bubble: (Line & { until: number }) | null = null;
  /** A grappling rope while one is out: its line, hook end and loose end. */
  rope: { x: number; top: number; bottom: number } | null = null;
  /** A weather cloud that follows him, and what is falling out of it. */
  cloud: { x: number; kind: 'rain' | 'snow' | 'storm'; until: number } | null = null;
  /** True while his umbrella is up. */
  umbrella = false;
  /** Where the sofa and TV stand while he uses them. */
  prop: { x: number; y: number } | null = null;
  flowers: Flower[] = [];
  mood: Mood = CALM;
  private steps: Step[] = [];
  private cur: Running | null = null;
  private world: World | null = null;
  private view: { top: number; bottom: number } | null = null;
  private viewStill = 0;
  private missing = 0;
  /** Session time of his next remark while settled. */
  private nextAside = 0;
  /** The first moment of the umbrella gag, before he reacts. */
  private soaked = false;

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
    this.bubble = null;
    this.rope = null;
    this.prop = null;
    this.cur = null;
    this.steps = [];
    // A resize re-plans the same activity; he has already said why.
    if (keepActivity) this.start(this.activity === 'drive' ? 'wander' : this.activity, true);
  }

  /** The owner's day, re-read every few minutes. */
  setMood(m: Mood) {
    this.mood = m;
    if (m.cloud) this.cloud = { x: this.cloud?.x ?? this.x, kind: m.cloud, until: Infinity };
    if (!m.cloud && this.cloud?.until === Infinity) this.cloud = null;
  }

  /** The part of the page the visitor can see, in page coordinates. */
  setView(top: number, bottom: number) {
    const v = this.view;
    if (!v || Math.abs(v.top - top) > 4 || Math.abs(v.bottom - bottom) > 4) this.viewStill = 0;
    this.view = { top, bottom };
  }

  /** Wave at a visitor, if he is somewhere he can stop. */
  greet() {
    const c = this.cur;
    if (!c || this.inCar || (c.type !== 'go' && c.type !== 'do')) return;
    this.steps.unshift(c.type === 'do' ? { type: 'do', act: c.act, dur: Math.max(1, c.dur - c.t) } : { type: 'go', x: c.x, gait: c.gait });
    this.cur = { type: 'wave', t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
  }

  /** A floor the visitor can see with room above it for him to stand. */
  private seen(f: Floor) {
    const v = this.view;
    return !v || (f.y - this.height - 8 >= v.top && f.y + 4 <= v.bottom);
  }

  private visible() {
    const v = this.view;
    return !v || (this.y > v.top && this.y - this.height < v.bottom);
  }

  /** Somewhere on screen to do something that can be done anywhere. */
  private anywhere(): { floor: Floor; x: number } {
    const w = this.world!;
    const inView = w.floors.filter((f) => this.seen(f));
    const pool = inView.length ? inView : w.floors;
    const floor = pool[Math.floor(this.random() * pool.length)];
    return { floor, x: floor.x1 + w.margin + 30 + this.random() * Math.max(0, floor.x2 - floor.x1 - 2 * w.margin - 60) };
  }

  private speak(line: Line | null, seconds: number) {
    if (line) this.bubble = { ...line, until: this.clock + seconds };
  }

  start(activity: Activity, quiet = false) {
    const w = this.world;
    if (!w || !this.floor) return;
    this.activity = activity;
    this.bubble = null;
    this.prop = null;
    // Mostly he says what he is off to do, and why when jk's day decided it.
    if (!quiet && this.random() < 0.85) this.speak(want(activity, this.mood.because[activity], this.random), 3);
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
    } else if (spot && (this.seen(spot.floor) || FIXED.includes(activity))) {
      floor = spot.floor;
      x = spot.x;
    } else if (activity === 'wander' || activity === 'run') {
      const choices = w.floors.filter((f) => this.seen(f) && (f !== this.floor || activity === 'wander'));
      floor = choices[Math.floor(this.random() * choices.length)] ?? this.floor;
      x = floor.x1 + w.margin + this.random() * Math.max(0, floor.x2 - floor.x1 - 2 * w.margin);
    } else {
      // Its usual place is off screen: he does it wherever the visitor is.
      ({ floor, x } = this.anywhere());
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
    const settle = (act: Mode | 'workout', a: number, b: number) => this.steps.push({ type: 'do', act, dur: r(a, b) });
    switch (activity) {
      case 'wander':
      case 'run':
        settle('idle', 1.2, 2.6);
        break;
      case 'drive': {
        if (!this.car) break;
        const f = this.car.floor;
        const far = this.car.x - f.x1 > f.x2 - this.car.x ? f.x1 + 30 : f.x2 - 30;
        this.steps.push({ type: 'enter' }, { type: 'drive', x: far }, { type: 'drive', x: this.car.x }, { type: 'exit' }, { type: 'do', act: 'idle', dur: 1 });
        break;
      }
      case 'workout':
        settle('workout', 9, 13);
        break;
      case 'think':
        settle('think', 6, 9);
        break;
      case 'study':
        settle('study', 8, 12);
        break;
      case 'lookout':
        settle('lookout', 5, 8);
        break;
      case 'sleep':
        settle('sleep', 10, 14);
        break;
      case 'garden':
        // Dig a hole, then kneel and plant something in it.
        settle('dig', 3.5, 5);
        settle('plant', 2.4, 3);
        break;
      case 'tv':
        settle('tv', 10, 15);
        break;
      case 'sofa':
        settle('sofa', 9, 14);
        break;
      case 'stressed':
        settle('stressed', 6, 8);
        break;
      case 'anxious':
        settle('anxious', 6, 9);
        break;
      case 'umbrella':
        settle('umbrella', 8, 11);
        break;
    }
  }

  private next() {
    const odds = this.mood.odds;
    const weight = (a: Activity) => WEIGHTS[a] * (odds[a] ?? 1);
    const options = (Object.keys(WEIGHTS) as Activity[]).filter((a) => {
      if (a !== 'wander' && a === this.activity) return false;
      // Fixed-place activities only when that place is on screen.
      if (a === 'drive') return !!this.car && this.seen(this.car.floor);
      if (a === 'lookout') return !!this.world?.spots.lookout && this.seen(this.world.spots.lookout.floor);
      // The umbrella gag is for dry days; on wet ones he carries it anyway.
      if (a === 'umbrella') return !this.mood.cloud;
      return true;
    });
    const total = options.reduce((s, a) => s + weight(a), 0);
    let roll = this.random() * total;
    for (const a of options) {
      roll -= weight(a);
      if (roll <= 0) return this.start(a);
    }
    this.start('wander');
  }

  /** Off screen too long: run back into view, or rope in if it is far. */
  private chase() {
    const w = this.world!;
    const v = this.view!;
    const inView = w.floors.filter((f) => this.seen(f));
    if (!inView.length || !this.floor) return;
    const mid = (v.top + v.bottom) / 2;
    const floor = inView.reduce((a, b) => (Math.abs(b.y - mid) < Math.abs(a.y - mid) ? b : a));
    const x = clampTo(w, Math.max(floor.x1, Math.min(floor.x2, this.x)), floor);
    this.prop = null;
    this.activity = 'wander';
    this.speak({ text: SPECIAL.chasing, kind: 'say' }, 2);
    const far = Math.abs(this.y - floor.y) > (v.bottom - v.top) * 0.8;
    const links = far ? null : route(w, this.floor, this.x, floor);
    if (links) {
      this.steps = [];
      for (const link of links) this.steps.push({ type: 'go', x: link.fx, gait: 'run' }, { type: 'link', link });
      this.steps.push({ type: 'go', x, gait: 'run' });
    } else {
      this.steps = [{ type: 'zip', floor, x, fromAbove: this.y < v.top }];
    }
    this.steps.push({ type: 'wave', text: SPECIAL.found });
    this.cur = null;
  }

  update(dt: number) {
    if (!this.world || !this.floor) return;
    this.clock += dt;
    this.viewStill += dt;
    this.missing = this.visible() ? 0 : this.missing + dt;
    const busy = this.cur && (this.cur.type === 'link' || this.cur.type === 'zip' || this.cur.type === 'drive' || this.cur.type === 'enter' || this.cur.type === 'exit');
    if (this.view && this.missing > MISSED && this.viewStill > 0.5 && !busy) {
      this.missing = 0;
      this.chase();
    }
    this.followCloud(dt);
    this.soaked = false;
    if (this.bubble && this.clock > this.bubble.until) this.bubble = null;
    if (!this.cur) {
      if (!this.steps.length) this.next();
      const s = this.steps.shift();
      if (!s) return;
      this.cur = { ...s, t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
      if (s.type === 'do') {
        this.actT = 0;
        this.actDur = s.dur;
        this.nextAside = this.clock + 3 + this.random() * 4;
        if (s.act === 'tv' || s.act === 'sofa') this.prop = { x: this.x, y: this.floor.y };
        if (s.act === 'umbrella') this.cloud = { x: this.x, kind: 'rain', until: this.clock + s.dur + 1 };
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
      case 'zip':
        this.zip(c, dt, done);
        break;
      case 'land':
        this.mode = 'land';
        if (c.t > 0.18) done();
        break;
      case 'do':
        this.y = this.floor.y;
        this.actT = c.t;
        this.animT += dt;
        this.settled(c);
        // Now and then a remark about what he is doing.
        if (this.clock > this.nextAside && !this.bubble) {
          this.nextAside = this.clock + 9 + this.random() * 8;
          if (this.random() < 0.6) this.speak(aside(this.activity, !!this.cloud && this.cloud.kind !== 'snow', this.random), 2.6);
        }
        if (c.t >= c.dur) {
          if (c.act === 'plant') this.plant();
          if (c.act === 'tv' || c.act === 'sofa') this.prop = null;
          done();
        }
        break;
      case 'wave':
        this.mode = 'wave';
        this.animT += dt;
        if (c.stage === 0) {
          c.stage = 1;
          this.speak({ text: c.text ?? SPECIAL.hello, kind: 'say' }, 1.6);
        }
        if (c.t > 1.4) done();
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
    // The umbrella is up whenever it is raining on him and his hands are free.
    const raining = !!this.cloud && this.cloud.kind !== 'snow';
    const freeHands = this.mode === 'walk' || this.mode === 'run' || this.mode === 'idle' || this.mode === 'umbrella';
    this.umbrella = !this.inCar && raining && freeHands && !this.soaked && (this.mood.umbrella || this.activity === 'umbrella');
  }

  /** The settled part of an activity: some of them move about while it lasts. */
  private settled(c: Running & { type: 'do' }) {
    const f = this.floor!;
    const w = this.world!;
    switch (c.act) {
      case 'workout':
        this.mode = Math.floor(c.t / 4.5) % 2 ? 'pushup' : 'skip';
        return;
      case 'idle':
        this.mode = 'idle';
        if (c.stage === 0 && c.t > c.dur / 2) {
          c.stage = 1;
          this.dir = this.dir === 1 ? -1 : 1;
        }
        return;
      case 'stressed': {
        // Pacing: a quick walk back and forth, hands on his head.
        const span = Math.min(28, (f.x2 - f.x1) / 2 - w.margin);
        const phase = c.t * 2.2;
        this.x = clampTo(w, c.x0 + span * Math.sin(phase), f);
        this.dir = Math.cos(phase) >= 0 ? 1 : -1;
        this.mode = 'stressed';
        return;
      }
      case 'anxious':
        // Glancing one way, then the other.
        this.dir = Math.floor(c.t / 1.1) % 2 ? -1 : 1;
        this.mode = 'anxious';
        return;
      case 'umbrella':
        // The cloud arrives and soaks him before he gets the umbrella up.
        if (c.t < 1.2) {
          this.mode = 'idle';
          this.soaked = true;
          if (c.t > 0.5 && this.bubble?.text !== SPECIAL.caught) this.speak({ text: SPECIAL.caught, kind: 'say' }, 0.7);
        } else {
          this.mode = 'umbrella';
        }
        return;
      default:
        this.mode = c.act;
    }
  }

  private plant() {
    const key = this.floor!.keys[0];
    let x = clampTo(this.world!, this.x + this.dir * 10, this.floor!);
    // Not on top of one already growing there.
    for (let i = 0; i < 6 && this.flowers.some((f) => f.key === key && Math.abs(f.x - x) < 10); i++) x = clampTo(this.world!, x + this.dir * 10, this.floor!);
    this.flowers.push({ key, x, colour: FLOWERS[Math.floor(this.random() * FLOWERS.length)], born: this.clock });
    // A small bed, not a meadow: the oldest makes way.
    if (this.flowers.length > 9) this.flowers.shift();
  }

  private followCloud(dt: number) {
    const cl = this.cloud;
    if (!cl) return;
    if (cl.until !== Infinity && this.clock > cl.until) {
      this.cloud = null;
      return;
    }
    // It lags behind him a little, as a cloud would.
    cl.x += (this.x - cl.x) * Math.min(1, dt * 3);
  }

  /**
   * Back into view on a rope: down from the top of the screen if the visitor
   * scrolled down past him, up from the bottom edge if they scrolled up.
   */
  private zip(c: Running & { type: 'zip' }, dt: number, done: () => void) {
    const v = this.view ?? { top: c.floor.y - 400, bottom: c.floor.y + 200 };
    const h = this.height;
    const target = c.floor.y;
    if (c.stage === 0) {
      this.inCar = false;
      this.x = c.x;
      this.floor = c.floor;
      this.dir = 1;
      if (c.fromAbove) {
        this.y = v.top - 10;
        this.rope = { x: c.x, top: v.top - 400, bottom: target };
      } else {
        this.y = v.bottom + h + 10;
        this.rope = { x: c.x, top: target, bottom: v.bottom + 400 };
      }
      c.stage = 1;
      c.t = 0;
    }
    if (c.stage === 1) {
      this.mode = 'rope';
      this.animT += dt;
      if (c.fromAbove) {
        this.y = Math.min(target, this.y + SPEED.zip * dt);
        if (this.y >= target) {
          c.stage = 2;
          c.t = 0;
        }
      } else {
        this.y = Math.max(target + h * 0.5, this.y - SPEED.zip * dt);
        if (this.y <= target + h * 0.5) {
          c.stage = 2;
          c.t = 0;
          c.y0 = this.y;
        }
      }
      return;
    }
    if (c.stage === 2) {
      if (!c.fromAbove) {
        // Pull up over the edge.
        const k = Math.min(1, c.t / 0.4);
        this.mode = 'mantle';
        this.y = c.y0 + (target - c.y0) * k;
        if (k < 1) return;
      }
      this.y = target;
      c.stage = 3;
      c.t = 0;
      return;
    }
    // Gather the rope away.
    this.mode = 'idle';
    const k = Math.min(1, c.t / 0.3);
    if (this.rope) {
      if (c.fromAbove) this.rope.top = this.rope.top + (target - this.rope.top) * k;
      else this.rope.bottom = this.rope.bottom + (target - this.rope.bottom) * k;
    }
    if (k >= 1) {
      this.rope = null;
      done();
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
