// What the rambler is doing and where he is: a choice of what to do next
// (drives.ts: what he needs, not a dice roll) on top of a small step machine
// (walk, climb, drop, drive, ride). States that are not choices — stress,
// tiredness, cold — show as short episodes and on his face. He keeps to the
// part of the page the visitor is looking at, chasing them down if they
// scroll away. Pure apart from the random source, which tests replace. The
// overlay calls `update` each frame and reads the public fields to draw him.

import { Animator } from './animator';
import { CHOICES, commitment, episodeReason, pick, reasonFor, rebase, relieve, score, startDrives, states, torn, type Choice, type Drives } from './drives';
import { CALM, type Mood } from './mood';
import { FRONT_MODES, type Face, type Mode, type Pose, type View } from './rig';
import { aside, SPECIAL, want, type Line, type Reason } from './talk';
import { clampTo, route, type Floor, type Link, type Spot, type World } from './world';

type Climb = Exclude<Link, { type: 'drop' }>;

/** Short states he shows rather than chooses. */
export type Episode = 'stressed' | 'anxious' | 'mad' | 'surprised' | 'fidget' | 'shiver' | 'yawn' | 'celebrate' | 'fan';
export type Activity = Choice | Episode;

type Act = Mode | 'workout';

type Step =
  | { type: 'go'; x: number; gait: 'walk' | 'run' }
  | { type: 'link'; link: Link }
  | { type: 'land' }
  | { type: 'do'; act: Act; dur: number }
  | { type: 'wave'; text?: string }
  | { type: 'enter' }
  | { type: 'stall' }
  | { type: 'drive'; x: number }
  | { type: 'ride'; x: number }
  | { type: 'exit' }
  | { type: 'zip'; floor: Floor; x: number; fromAbove: boolean };

type Running = Step & { t: number; stage: number; vy: number; x0: number; y0: number; miss?: boolean };

const SPOT_FOR: Partial<Record<Activity, Spot>> = {
  lookout: 'lookout',
  stargaze: 'lookout',
  study: 'desk',
  think: 'think',
  workout: 'gym',
  sleep: 'bed',
  drive: 'garage',
};

/** Activities tied to one place on the page: no point if it is out of view. */
const FIXED: Activity[] = ['lookout', 'stargaze', 'drive'];
const EPISODES: Episode[] = ['stressed', 'anxious', 'mad', 'surprised', 'fidget', 'shiver', 'yawn', 'celebrate', 'fan'];

/** Page pixels per second. */
const SPEED = { walk: 34, run: 82, climb: 26, abseil: 80, drive: 120, ride: 70, zip: 260 };

/** Seconds out of view (with the page still) before he comes looking. */
const MISSED = 1.2;
const FLOWERS = ['#d2402a', '#e8b21f', '#8a5bb0', '#f2ede4', '#e86aa0'];
/** Art pixels tall, standing. */
export const HEIGHT = 39;

export interface Flower {
  key: number;
  x: number;
  colour: string;
  /** Session clock when planted: it grows over the next few seconds. */
  born: number;
}

export interface Snowman {
  key: number;
  x: number;
  born: number;
}

export type PropKind = 'sofa' | 'tv' | 'table' | 'mat' | 'puddle';

export class Resident {
  x = 0;
  y = 0;
  dir: 1 | -1 = 1;
  mode: Mode = 'idle';
  view: View = 'side';
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
  /** True while the car is coughing and will not start. */
  stalling = false;
  /** On the bike. */
  riding = false;
  /** What he is saying or thinking, until the session clock passes `until`. */
  bubble: (Line & { until: number }) | null = null;
  /** A grappling rope while one is out: its line, hook end and loose end. */
  rope: { x: number; top: number; bottom: number } | null = null;
  /** A weather cloud that follows him, and what is falling out of it. */
  cloud: { x: number; kind: 'rain' | 'snow' | 'storm'; until: number } | null = null;
  /** True while his umbrella is up. */
  umbrella = false;
  /** Furniture he is using, where it stands. */
  prop: { x: number; y: number; kind: PropKind } | null = null;
  flowers: Flower[] = [];
  snowmen: Snowman[] = [];
  mood: Mood = CALM;
  drives: Drives = startDrives(CALM.input);
  /** The pose to draw this frame. */
  pose: Pose | null = null;
  readonly anim: Animator;
  private steps: Step[] = [];
  private cur: Running | null = null;
  private world: World | null = null;
  private view_: { top: number; bottom: number } | null = null;
  private viewStill = 0;
  private missing = 0;
  /** Session time of his next remark while settled. */
  private nextAside = 0;
  /** Distance walked, in art units: the gait's phase. */
  private dist = 0;
  private speedArt = 0;
  /** How fresh each choice feels, 0 (just done) to 1. */
  private hab: Partial<Record<Choice, number>> = {};
  private startedAt = 0;
  private cool: Partial<Record<Episode, number>> = {};
  /** Lost his temper already this visit. */
  private madUsed = false;
  /** The umbrella gag ends in a tantrum this time. */
  private gagMad = false;
  private pending: Episode | null = null;
  private look = 0;
  private lookUntil = 0;
  /** How long to keep at the current activity, as a multiple of its usual length. */
  private commit = 1;

  /** His height on screen, for knowing when his hands reach a ledge. */
  readonly height: number;

  constructor(
    private readonly random: () => number = Math.random,
    /** Page pixels per art pixel. */
    readonly scale = 1.5,
  ) {
    this.height = HEIGHT * scale;
    this.anim = new Animator(random);
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
    this.riding = false;
    this.stalling = false;
    this.bubble = null;
    this.rope = null;
    this.prop = null;
    this.cur = null;
    this.steps = [];
    // A resize re-plans the same activity; he has already said why.
    if (keepActivity) this.start(this.activity === 'drive' || this.activity === 'cycle' ? 'wander' : this.activity, true);
  }

  /** The owner's day, re-read every so often. */
  setMood(m: Mood) {
    this.mood = m;
    this.drives = rebase(this.drives, m.input);
    if (m.cloud) this.cloud = { x: this.cloud?.x ?? this.x, kind: m.cloud, until: Infinity };
    if (!m.cloud && this.cloud?.until === Infinity) this.cloud = null;
  }

  /** The part of the page the visitor can see, in page coordinates. */
  setView(top: number, bottom: number) {
    const v = this.view_;
    if (!v || Math.abs(v.top - top) > 4 || Math.abs(v.bottom - bottom) > 4) this.viewStill = 0;
    this.view_ = { top, bottom };
  }

  /** Something good happened in jk's day while the visitor was here. */
  celebrate() {
    this.pending = 'celebrate';
  }

  /** The visitor's pointer, in page coordinates: he follows it with his eyes. */
  lookAt(x: number) {
    this.look = Math.max(-1, Math.min(1, (x - this.x) / 60));
    this.lookUntil = this.clock + 2;
  }

  /** Wave at a visitor, if he is somewhere he can stop. */
  greet() {
    const c = this.cur;
    if (!c || this.inCar || this.riding || (c.type !== 'go' && c.type !== 'do')) return;
    this.steps.unshift(c.type === 'do' ? { type: 'do', act: c.act, dur: Math.max(1, c.dur - c.t) } : { type: 'go', x: c.x, gait: c.gait });
    this.cur = { type: 'wave', t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
  }

  /** A floor the visitor can see with room above it for him to stand. */
  private seen(f: Floor) {
    const v = this.view_;
    return !v || (f.y - this.height - 8 >= v.top && f.y + 4 <= v.bottom);
  }

  private visible() {
    const v = this.view_;
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

  /** Start an activity. `reason` is what tipped it, for his thought bubble. */
  start(activity: Activity, quiet = false, reason?: Reason) {
    const w = this.world;
    if (!w || !this.floor) return;
    this.finishActivity();
    // Whatever he was in the middle of stops here.
    this.cur = null;
    this.rope = null;
    this.activity = activity;
    this.startedAt = this.clock;
    this.bubble = null;
    this.prop = null;
    // Mostly he says what he is off to do, and why when jk's day decided it.
    if (!quiet && this.random() < 0.85) this.speak(want(activity, reason, this.random), 3);
    if (this.inCar && this.car) {
      // Interrupted mid-drive: he parks where he is and gets out.
      this.car.x = this.x;
      this.inCar = false;
    }
    this.riding = false;
    this.stalling = false;
    const r = (a: number, b: number) => (a + this.random() * (b - a)) * this.commit;
    const settle = (act: Act, a: number, b: number) => this.steps.push({ type: 'do', act, dur: r(a, b) });
    // Episodes happen where he stands.
    if ((EPISODES as Activity[]).includes(activity)) {
      this.steps = [];
      const len: Record<Episode, [number, number]> = {
        stressed: [4, 5],
        anxious: [4, 6],
        mad: [3, 3.5],
        surprised: [1.2, 1.4],
        fidget: [1.8, 2.4],
        shiver: [2.5, 3.5],
        yawn: [3.4, 3.6],
        celebrate: [2.2, 2.8],
        fan: [3.5, 4.5],
      };
      const [a, b] = len[activity as Episode];
      this.steps.push({ type: 'do', act: activity as Mode, dur: a + this.random() * (b - a) });
      this.commit = 1;
      return;
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
    switch (activity) {
      case 'wander':
      case 'run':
        settle('idle', 1.2, 2.6);
        break;
      case 'drive': {
        if (!this.car) break;
        const f = this.car.floor;
        const far = this.car.x - f.x1 > f.x2 - this.car.x ? f.x1 + 30 : f.x2 - 30;
        this.steps.push({ type: 'enter' });
        // In a hard frost the car will not start, and that is the last straw.
        if (this.drives.input.temp < 3 && !this.madUsed && this.random() < 0.5) {
          this.steps.push({ type: 'stall' }, { type: 'exit' }, { type: 'do', act: 'mad', dur: 3.2 });
          this.madUsed = true;
          break;
        }
        this.steps.push({ type: 'drive', x: far }, { type: 'drive', x: this.car.x }, { type: 'exit' }, { type: 'do', act: 'idle', dur: 1 });
        break;
      }
      case 'cycle': {
        const f = floor;
        const end = clampTo(w, x, f);
        const far = end - f.x1 > f.x2 - end ? f.x1 + w.margin + 20 : f.x2 - w.margin - 20;
        this.steps.push({ type: 'ride', x: far }, { type: 'ride', x: end }, { type: 'do', act: 'idle', dur: 1 });
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
      case 'stargaze':
        settle('stargaze', 8, 12);
        break;
      case 'sleep':
        settle('sleep', 10, 14);
        break;
      case 'nap':
        settle('nap', 10, 14);
        break;
      case 'garden':
        // Dig a hole, then kneel and plant something in it.
        settle('dig', 3.5, 5);
        settle('plant', 2.4, 3);
        break;
      case 'snowman':
        settle('roll', 4, 5);
        settle('plant', 1.6, 2);
        break;
      case 'tv':
        settle('tv', 10, 15);
        break;
      case 'sofa':
        settle('sofa', 9, 14);
        break;
      case 'tea':
        settle('tea', 8, 12);
        break;
      case 'eat':
        settle('eat', 8, 11);
        break;
      case 'meditate':
        settle('meditate', 9, 13);
        break;
      case 'puddle':
        settle('puddle', 4, 6);
        break;
      case 'umbrella':
        // The tantrum, when there is one, comes after the soaking.
        this.gagMad = !this.madUsed && this.random() < 0.5;
        if (this.gagMad) this.madUsed = true;
        this.steps.push({ type: 'do', act: 'umbrella', dur: (8 + this.random() * 3) * this.commit + (this.gagMad ? 3 : 0) });
        break;
    }
    this.commit = 1;
  }

  /** Doing it changed him; and he goes off it for a while. */
  private finishActivity() {
    const a = this.activity;
    const spent = this.clock - this.startedAt;
    if ((CHOICES as readonly Activity[]).includes(a) && spent > 0) {
      relieve(this.drives, a as Choice, spent);
      for (const k of CHOICES) {
        const h = this.hab[k] ?? 1;
        this.hab[k] = 1 - (1 - h) * Math.exp(-spent / 60);
      }
      this.hab[a as Choice] = 0.3;
    }
  }

  private allowed = (a: Choice) => {
    if (a !== 'wander' && a === this.activity) return false;
    // Fixed-place activities only when that place is on screen.
    if (a === 'drive') return !!this.car && this.seen(this.car.floor);
    if (a === 'lookout' || a === 'stargaze') return !!this.world?.spots.lookout && this.seen(this.world.spots.lookout.floor);
    return true;
  };

  private episode(e: Episode, cooldown: number) {
    if ((this.cool[e] ?? -Infinity) > this.clock) return false;
    this.cool[e] = this.clock + cooldown;
    // Moods jk's day explains get said out loud; the rest mostly pass in silence.
    const why = e === 'stressed' || e === 'anxious' || e === 'mad' ? episodeReason(this.drives) : undefined;
    this.start(e, !why && this.random() < 0.6, why);
    return true;
  }

  private next() {
    const s = states(this.drives);
    const was = this.activity;
    if (this.pending) {
      const e = this.pending;
      this.pending = null;
      this.start(e);
      return;
    }
    // States first: they interrupt whatever he would have chosen.
    if (!(EPISODES as Activity[]).includes(was)) {
      // Boiling over is once a visit, whatever set it off.
      if (s.mad && !this.madUsed && this.episode('mad', 60)) {
        this.madUsed = true;
        return;
      }
      if (s.stressed && this.episode('stressed', 40)) return;
      if (s.anxious && this.random() < 0.25 && this.episode('anxious', 45)) return;
      if (s.sleepy && this.random() < this.drives.d.sleep * 0.5 && this.episode('yawn', 25)) return;
      if (s.cold && this.random() < 0.3 && this.episode('shiver', 30)) return;
      if (s.hot && this.random() < 0.3 && this.episode('fan', 30)) return;
    }
    const scored = score(this.drives, this.hab, this.allowed);
    if (torn(scored) && this.random() < 0.5 && !(EPISODES as Activity[]).includes(was) && this.episode('fidget', 30)) return;
    const o = pick(scored, this.random);
    if (!o) return this.start('wander');
    this.commit = commitment(this.drives, o);
    this.start(o.a, false, reasonFor(this.drives, o));
  }

  /** Off screen too long: run back into view, or rope in if it is far. */
  private chase() {
    const w = this.world!;
    const v = this.view_!;
    const inView = w.floors.filter((f) => this.seen(f));
    if (!inView.length || !this.floor) return;
    const mid = (v.top + v.bottom) / 2;
    const floor = inView.reduce((a, b) => (Math.abs(b.y - mid) < Math.abs(a.y - mid) ? b : a));
    const x = clampTo(w, Math.max(floor.x1, Math.min(floor.x2, this.x)), floor);
    this.finishActivity();
    this.prop = null;
    this.riding = false;
    this.activity = 'wander';
    this.startedAt = this.clock;
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
    const busy = this.cur && (this.cur.type === 'link' || this.cur.type === 'zip' || this.cur.type === 'drive' || this.cur.type === 'enter' || this.cur.type === 'exit' || this.cur.type === 'stall');
    if (this.view_ && this.missing > MISSED && this.viewStill > 0.5 && !busy) {
      this.missing = 0;
      this.chase();
    }
    this.followCloud(dt);
    if (this.bubble && this.clock > this.bubble.until) this.bubble = null;
    const x0 = this.x;
    if (!this.cur) {
      if (!this.steps.length) this.next();
      const s = this.steps.shift();
      if (!s) return;
      this.cur = { ...s, t: 0, stage: 0, vy: 0, x0: this.x, y0: this.y };
      if (s.type === 'do') {
        this.actT = 0;
        this.actDur = s.dur;
        this.animT = 0;
        this.nextAside = this.clock + 3 + this.random() * 4;
        const kind: PropKind | null =
          s.act === 'tv' ? 'tv' : s.act === 'sofa' || s.act === 'nap' ? 'sofa' : s.act === 'tea' || s.act === 'eat' ? 'table' : s.act === 'meditate' ? 'mat' : s.act === 'puddle' ? 'puddle' : null;
        if (kind) this.prop = { x: this.x, y: this.floor.y, kind };
        if (s.act === 'umbrella') this.cloud = { x: this.x, kind: 'rain', until: this.clock + s.dur + 1 };
      }
    }
    this.step(this.cur!, dt);
    // Gait phase and speed, in art units, for the feet and the hair.
    const moved = this.x - x0;
    if (this.mode === 'walk' || this.mode === 'run' || this.mode === 'cycle') this.dist += Math.abs(moved) / this.scale;
    this.speedArt = dt > 0 ? Math.abs(moved) / this.scale / dt : 0;
    // The umbrella is up whenever it is raining on him and his hands are free.
    const raining = !!this.cloud && this.cloud.kind !== 'snow';
    const freeHands = this.mode === 'walk' || this.mode === 'run' || this.mode === 'idle' || this.mode === 'umbrella' || this.mode === 'look';
    // In the dry-day gag it goes up only after the soaking has landed.
    this.umbrella = this.activity === 'umbrella' ? this.mode === 'umbrella' : !this.inCar && !this.riding && raining && freeHands && this.mood.umbrella;
    this.view = this.viewFor();
    this.pose = this.anim.step(dt, {
      mode: this.mode,
      view: this.view,
      t: this.animT,
      dist: this.dist,
      speed: this.speedArt,
      face: this.face(),
      look: this.clock < this.lookUntil ? this.look : 0,
    });
  }

  /** Front on when he has stopped and his face is the point; from behind on a rope. */
  private viewFor(): View {
    if (this.mode === 'rope') return 'back';
    const c = this.cur;
    // Between steps, hold the view he had.
    if (!c) return this.view;
    if (c.type !== 'do' && c.type !== 'wave') return 'side';
    if (this.umbrella) return 'side';
    return FRONT_MODES.includes(this.mode) ? 'front' : 'side';
  }

  /** What the mood puts on his face while he does something plain. */
  private face(): Face | null {
    const s = states(this.drives);
    if (s.mad) return 'mad';
    if (s.stressed) return 'stressed';
    if (s.cold && this.mood.scarf) return 'cold';
    if (s.hot) return 'hot';
    if (s.sleepy) return 'tired';
    return null;
  }

  private step(c: Running, dt: number) {
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
    const f = this.floor!;
    switch (c.type) {
      case 'go':
        this.y = f.y;
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
        // A squash on landing, held just long enough to read.
        this.mode = 'land';
        if (c.t > 0.2) done();
        break;
      case 'do':
        this.y = f.y;
        this.actT = c.t;
        this.animT += dt;
        this.settled(c);
        // Now and then a remark about what he is doing.
        if (this.clock > this.nextAside && !this.bubble) {
          this.nextAside = this.clock + 9 + this.random() * 8;
          if (this.random() < 0.6) this.speak(aside(this.activity, !!this.cloud && this.cloud.kind !== 'snow', this.random), 2.6);
        }
        if (c.t >= c.dur) {
          if (c.act === 'plant') this.activity === 'snowman' ? this.buildSnowman() : this.plant();
          if (this.prop && c.act !== 'dig' && c.act !== 'roll') this.prop = null;
          done();
        }
        break;
      case 'wave':
        this.mode = 'wave';
        this.animT += dt;
        if (c.stage === 0) {
          c.stage = 1;
          this.animT = 0;
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
      case 'stall':
        // Turning the key: the car coughs and shudders, and dies.
        this.inCar = true;
        this.stalling = c.t < 1.6;
        this.animT += dt;
        if (c.t > 2) {
          this.stalling = false;
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
      case 'ride': {
        this.riding = true;
        this.y = f.y;
        const dx = c.x - this.x;
        if (Math.abs(dx) < 0.8) {
          this.x = c.x;
          if (!this.steps.length || this.steps[0].type !== 'ride') this.riding = false;
          done();
          break;
        }
        this.dir = dx > 0 ? 1 : -1;
        const speed = SPEED.ride * Math.min(1, 0.3 + Math.min(c.t, Math.abs(dx) / 30));
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        this.mode = 'cycle';
        this.animT += dt;
        break;
      }
    }
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
        // Clutching his head front on, then a quick pace side on.
        if (c.t < c.dur * 0.55) {
          this.mode = 'stressed';
          return;
        }
        const span = Math.min(28, (f.x2 - f.x1) / 2 - w.margin);
        const phase = (c.t - c.dur * 0.55) * 2.2;
        this.x = clampTo(w, c.x0 + span * Math.sin(phase), f);
        this.dir = Math.cos(phase) >= 0 ? 1 : -1;
        this.mode = 'walk';
        return;
      }
      case 'umbrella': {
        // The cloud arrives and soaks him; sometimes he loses it; then the umbrella goes up.
        const madFor = this.gagMad ? 3 : 0;
        if (c.t < 0.5) this.mode = 'idle';
        else if (c.t < 1.2) {
          this.mode = 'surprised';
          this.animT = c.t - 0.5;
        } else if (c.t < 1.2 + madFor) {
          this.mode = 'mad';
          this.animT = c.t - 1.2;
        } else this.mode = 'umbrella';
        return;
      }
      default:
        this.mode = c.act;
    }
  }

  private plant() {
    const key = this.floor!.keys[0];
    let x = clampTo(this.world!, this.x + this.dir * 14, this.floor!);
    // Not on top of one already growing there.
    for (let i = 0; i < 6 && this.flowers.some((f) => f.key === key && Math.abs(f.x - x) < 12); i++) x = clampTo(this.world!, x + this.dir * 12, this.floor!);
    this.flowers.push({ key, x, colour: FLOWERS[Math.floor(this.random() * FLOWERS.length)], born: this.clock });
    // A small bed, not a meadow: the oldest makes way.
    if (this.flowers.length > 9) this.flowers.shift();
  }

  private buildSnowman() {
    const key = this.floor!.keys[0];
    this.snowmen.push({ key, x: clampTo(this.world!, this.x + this.dir * 22, this.floor!), born: this.clock });
    if (this.snowmen.length > 2) this.snowmen.shift();
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
    const v = this.view_ ?? { top: c.floor.y - 400, bottom: c.floor.y + 200 };
    const h = this.height;
    const target = c.floor.y;
    if (c.stage === 0) {
      this.inCar = false;
      this.riding = false;
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
        // Wind-up: a crouch before the spring.
        this.mode = 'land';
        if (c.t > 0.18) stage(2);
        return;
      }
      const k = u(0.45);
      if (l.tx !== c.x0) this.dir = l.tx > c.x0 ? 1 : -1;
      this.mode = k < 0.12 ? 'hop' : 'jump';
      this.x = lerp(c.x0, l.tx, k);
      this.y = lerp(c.y0, l.to.y, k) - Math.sin(Math.PI * k) * (l.up ? 22 : 12);
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
            // Now and then the hook falls short, once a visit at most.
            c.miss = !this.madUsed && this.random() < 0.15;
            stage(2);
          }
          break;
        case 2: {
          // The hook flies up, paying out rope behind it.
          const rope = this.rope!;
          const top = c.miss ? l.from.y - (l.from.y - l.to.y) * 0.65 : l.to.y;
          rope.top = Math.max(top, rope.top - 900 * dt);
          if (rope.top <= top) {
            if (c.miss) {
              stage(7);
              break;
            }
            rope.bottom = l.from.y;
            stage(3);
          }
          break;
        }
        case 7: {
          // A miss: the hook drops back past him, and he takes it badly.
          this.mode = 'surprised';
          const rope = this.rope!;
          rope.top = Math.min(l.from.y, rope.top + 700 * dt);
          rope.bottom = Math.max(rope.bottom, rope.top);
          if (rope.top >= l.from.y) {
            this.rope = null;
            this.madUsed = true;
            this.steps.unshift({ type: 'do', act: 'mad', dur: 3.2 }, { type: 'link', link: l });
            done();
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
