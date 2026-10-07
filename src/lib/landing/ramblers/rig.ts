// The rambler's body: a small skeleton rasterised to art pixels every frame.
// A pose is a handful of joint angles, so limbs bend at real knees and elbows
// and hands reach exactly where the climbing code expects. Three views: side
// on while he goes about, front on when his face is the point, and from
// behind on a rope. Pure: no DOM, no canvas — the overlay scales these pixels
// and paints them.
//
// Coordinates are art units with the origin at the feet; +y is down. In the
// side view +x is the way he faces; in the front view +x is the viewer's
// right. Angles are degrees with 0 pointing down. Side view: 90 points
// forward, 180 up. Front view: positive points away from his middle.

import { BACK_HEAD, FRONT_HEAD, FRONT_NECK, SIDE_HEAD, SIDE_NECK, frontFace, sideFace, type Face } from './heads';

export type { Face } from './heads';

export type Mode =
  | 'idle'
  | 'look'
  | 'walk'
  | 'run'
  | 'lookout'
  | 'stargaze'
  | 'study'
  | 'think'
  | 'sleep'
  | 'nap'
  | 'skip'
  | 'pushup'
  | 'fall'
  | 'hop'
  | 'land'
  | 'wave'
  | 'jump'
  | 'wall'
  | 'mantle'
  | 'aim'
  | 'rope'
  | 'dig'
  | 'plant'
  | 'roll'
  | 'tv'
  | 'sofa'
  | 'tea'
  | 'eat'
  | 'meditate'
  | 'cycle'
  | 'puddle'
  | 'fan'
  | 'yawn'
  | 'stressed'
  | 'anxious'
  | 'mad'
  | 'surprised'
  | 'fidget'
  | 'shiver'
  | 'celebrate'
  | 'umbrella';

export type View = 'side' | 'front' | 'back';

/** Modes drawn front on once he has settled into them. */
export const FRONT_MODES: readonly Mode[] = ['idle', 'look', 'think', 'yawn', 'meditate', 'wave', 'stressed', 'anxious', 'mad', 'surprised', 'fidget', 'shiver', 'celebrate', 'fan'];

export interface Build {
  thigh: number;
  shin: number;
  torso: number;
  upper: number;
  fore: number;
}

export interface Palette {
  skin: string;
  skinD: string;
  hair: string;
  hairL: string;
  shirt: string;
  shirtD: string;
  shirtL: string;
  collar: string;
  legs: string;
  legsD: string;
  shoe: string;
  sole: string;
  eye: string;
  white: string;
  mouth: string;
  teeth: string;
  tongue: string;
  blush: string;
  ink: string;
  scarf: string;
  scarfD: string;
}

export type Pixel = [x: number, y: number, colour: string];

export interface Figure {
  px: Pixel[];
  /** The near hand (side) or his right hand (front), where held things go. */
  hand: [number, number];
  /** Centre of the head, for bubbles and Zs. */
  head: [number, number];
  /** Top middle of the head, where accents sit. */
  crown: [number, number];
  /** Topmost occupied row (negative: above the feet). */
  top: number;
}

/** 39 art pixels standing, outline included. */
export const BUILD: Build = { thigh: 7, shin: 6, torso: 11, upper: 5, fore: 5 };

export const PALETTE: Palette = {
  skin: '#eab48a',
  skinD: '#c98a62',
  hair: '#4a2a14',
  hairL: '#74471f',
  shirt: '#d4621a',
  shirtD: '#a14612',
  shirtL: '#ef8f45',
  collar: '#f3e9d8',
  legs: '#41557f',
  legsD: '#2c3a5c',
  shoe: '#2a2420',
  sole: '#8c7b6c',
  eye: '#1d1209',
  white: '#fbf6ee',
  mouth: '#8a3a2a',
  teeth: '#fbf6ee',
  tongue: '#d8606a',
  blush: '#e58a78',
  ink: '#24170c',
  scarf: '#2f8f86',
  scarfD: '#1f655e',
};

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const ease = (k: number) => k * k * (3 - 2 * k);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

type Pair = [number, number];

/** What he is holding or using; drawn with the body so it moves with his hands. */
export interface Props {
  book?: boolean;
  /** Which page of the book is showing. */
  page?: number;
  mug?: boolean;
  fork?: boolean;
  spade?: boolean;
  launcher?: boolean;
  /** Skipping-rope angle. */
  skip?: number;
  /** Newspaper over his face (napping). */
  paper?: boolean;
  /** The bike, with the crank angle. */
  bike?: number;
  /** A snowball he is rolling, its radius. */
  ball?: number;
  telescope?: boolean;
}

/**
 * A pose. Limb pairs are [upper, lower] angles. Side view: legA/armA are the
 * near limbs; front view: A is his left (the viewer's left), B his right.
 */
export interface Pose {
  view: View;
  hipY: number;
  lean: number;
  rot: number;
  dx: number;
  dy: number;
  lift: number;
  headDy: number;
  legA: Pair;
  legB: Pair;
  armA: Pair;
  armB: Pair;
  /** Length scales for foreshortened limbs (a leg coming towards you). */
  legAk: number;
  legBk: number;
  armAk: number;
  armBk: number;
  face: Face;
  /** Where his eyes point, -1 left to 1 right (front view). */
  look: number;
  /** Part-way through turning, 0 front to 1 side (front view only). */
  yaw: number;
  /** Rest the lowest pixel on the floor after rotating (push-ups). */
  ground: boolean;
  props: Props;
}

export interface PoseContext {
  /** Distance walked so far in art units; drives the foot-locked gait. */
  dist?: number;
  /** Eyes towards a point, -1 to 1. */
  look?: number;
}

function base(view: View): Pose {
  return {
    view,
    hipY: NaN,
    lean: 0,
    rot: 0,
    dx: 0,
    dy: 0,
    lift: 0,
    headDy: 0,
    legA: view === 'side' ? [3, 0] : [4, 0],
    legB: view === 'side' ? [-3, 0] : [4, 0],
    armA: view === 'side' ? [8, 14] : [8, 4],
    armB: view === 'side' ? [-6, -2] : [8, 4],
    legAk: 1,
    legBk: 1,
    armAk: 1,
    armBk: 1,
    face: 'neutral',
    look: 0,
    yaw: 0,
    ground: false,
    props: {},
  };
}

// ---------------------------------------------------------------- gait

/** Thigh and shin angles that put the foot at (tx, ty) from the hip, knee forward. */
export function ik(tx: number, ty: number, b: Build = BUILD): Pair {
  const l1 = b.thigh;
  const l2 = b.shin;
  let d = Math.hypot(tx, ty);
  const max = l1 + l2 - 0.01;
  if (d > max) {
    tx *= max / d;
    ty *= max / d;
    d = max;
  }
  const at = Math.atan2(tx, ty);
  const knee = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * Math.max(d, 1e-6)))));
  const t1 = at + knee;
  const kx = Math.sin(t1) * l1;
  const ky = Math.cos(t1) * l1;
  return [t1 / DEG, Math.atan2(tx - kx, ty - ky) / DEG];
}

/**
 * Foot-locked gaits. Each foot is planted for `duty` of a cycle and slides back
 * under him by exactly the distance he covers, so it stays put on the floor;
 * the rest of the cycle it swings forward on an arc. The cycle is measured in
 * distance, not time, so whatever speed he moves at the feet never skate.
 */
export const GAITS = {
  walk: { sweep: 12, duty: 0.6, lift: 3, reach: 0.985 },
  run: { sweep: 13, duty: 0.35, lift: 5, reach: 0.95 },
} as const;

/** Body travel per full cycle (two steps). */
export const stride = (kind: keyof typeof GAITS) => {
  const g = GAITS[kind];
  // Stance covers `sweep` in `duty` of the cycle; flight adds the rest at the same speed.
  return g.sweep / g.duty;
};

export interface GaitFrame {
  legs: [Pair, Pair];
  hipY: number;
  lift: number;
  feet: { x: number; y: number; stance: boolean }[];
}

export function gait(kind: keyof typeof GAITS, dist: number, b: Build = BUILD): GaitFrame {
  const g = GAITS[kind];
  const L = b.thigh + b.shin;
  const cycle = dist / stride(kind);
  const feet = [0, 0.5].map((off) => {
    const u = (((cycle + off) % 1) + 1) % 1;
    if (u < g.duty) return { x: g.sweep / 2 - g.sweep * (u / g.duty), y: 0, stance: true, u };
    const s = (u - g.duty) / (1 - g.duty);
    return { x: -g.sweep / 2 + g.sweep * ease(s), y: -g.lift * Math.sin(Math.PI * s), stance: false, u };
  });
  const planted = feet.filter((f) => f.stance);
  const reach = g.reach * L;
  let hipY: number;
  let lift = 0;
  if (planted.length) hipY = Math.min(...planted.map((f) => Math.sqrt(Math.max(0, reach * reach - f.x * f.x))));
  else {
    // Flight: both feet up; the body rises and falls on a short arc.
    hipY = Math.sqrt(reach * reach - (g.sweep / 2) ** 2);
    const flight = (1 - 2 * g.duty) / 2;
    const into = Math.min(...feet.map((f) => (f.u - g.duty + 1) % 1));
    lift = 2 * Math.sin(Math.PI * Math.min(1, into / flight));
  }
  return { legs: [ik(feet[0].x, hipY + feet[0].y, b), ik(feet[1].x, hipY + feet[1].y, b)], hipY, lift, feet };
}

// ---------------------------------------------------------------- poses

const legReach = (b: Build, l: Pair, k = 1) => (b.thigh * Math.cos(l[0] * DEG) + b.shin * Math.cos(l[1] * DEG)) * k;

/** The yawn's arm lift, 0 to 1, over its 4.2 s cycle. */
const yawnUp = (t: number) => {
  const T = t % 4.2;
  return T < 0.6 ? ease(T / 0.6) : T < 2.4 ? 1 : T < 3 ? 1 - ease((T - 2.4) / 0.6) : 0;
};

function sidePose(mode: Mode, t: number, b: Build, ctx: PoseContext): Pose {
  const p = base('side');
  const breath = Math.sin((t * TAU) / 4);
  switch (mode) {
    case 'idle':
    case 'look':
      p.armA = [6 + breath * 3, 14 + breath * 4];
      p.armB = [-4 - breath * 2, 0];
      p.headDy = breath > 0.6 ? -0.6 : 0;
      break;
    case 'walk':
    case 'run': {
      const dist = ctx.dist ?? t * (mode === 'walk' ? 22 : 55);
      const g = gait(mode, dist, b);
      [p.legA, p.legB] = g.legs;
      p.hipY = g.hipY;
      p.lift = g.lift;
      // Arms swing with the opposite leg, the forearm trailing (follow-through).
      const sw = g.feet[1].x / (GAITS[mode].sweep / 2);
      if (mode === 'walk') {
        const lag = Math.sin((dist / stride('walk') + 0.5) * TAU - 0.6);
        p.armA = [24 * sw, 24 * sw + 26 + 8 * lag];
        p.armB = [-24 * sw, -24 * sw + 26 - 8 * lag];
        p.lean = 4;
        p.headDy = g.hipY < (b.thigh + b.shin) * 0.95 ? 0.7 : 0;
      } else {
        p.armA = [45 * sw, 45 * sw + 95];
        p.armB = [-45 * sw, -45 * sw + 95];
        p.lean = 14;
        p.face = 'strain';
      }
      break;
    }
    case 'lookout':
    case 'stargaze': {
      // Sat on the top edge, legs dangling over it.
      const w = 16 * Math.sin(t * 3);
      p.hipY = 0;
      p.legA = [88, 6 + w];
      p.legB = [82, 4 - w];
      p.armA = [18, 62];
      p.armB = [12, 52];
      if (mode === 'stargaze') {
        p.armA = [70, 150];
        p.armB = [60, 140];
        p.props.telescope = true;
        p.face = 'happy';
      }
      break;
    }
    case 'study':
      p.hipY = 0;
      p.legA = [88, 2];
      p.legB = [82, -2];
      p.armA = [22, 105];
      p.armB = [12, 98];
      p.props.book = true;
      p.props.page = Math.floor(t / 2.6) % 2;
      p.lean = 6;
      p.face = t % 6 < 0.15 ? 'blink' : 'neutral';
      break;
    case 'think':
      p.armA = [20, 165];
      p.armB = [18, 80];
      p.face = 'think';
      break;
    case 'sleep':
    case 'nap':
      p.legA = [0, 6];
      p.legB = [4, 10];
      p.armA = [6, 30];
      p.armB = [-4, 20];
      p.hipY = b.thigh + b.shin;
      p.rot = -90;
      p.dy = -2;
      p.dx = Math.round((b.thigh + b.shin + b.torso + 6) / 2);
      p.face = 'asleep';
      if (mode === 'nap') p.props.paper = true;
      break;
    case 'skip': {
      // Skipping rope: the hop peaks as the rope passes under the feet.
      const a = t * TAU * 1.6;
      p.props.skip = a;
      p.lift = Math.round(3 * Math.max(0, Math.cos(a)));
      p.legA = p.lift ? [28, -22] : [8, -4];
      p.legB = p.lift ? [18, -30] : [2, -8];
      p.armA = [25, 70];
      p.armB = [15, 65];
      p.face = 'strain';
      break;
    }
    case 'pushup': {
      const u = (Math.sin(t * TAU * 0.7) + 1) / 2;
      const bend = 45 * (1 - u);
      const reach = b.upper * Math.cos(bend * DEG) + b.fore * Math.cos(bend * DEG);
      const shoulder = b.thigh + b.shin + b.torso - 2;
      const rot = 90 - Math.asin(Math.min(1, reach / shoulder)) / DEG;
      p.hipY = b.thigh + b.shin;
      p.legA = [0, 0];
      p.legB = [0, 0];
      p.rot = rot;
      p.armA = [rot - bend, rot + bend];
      p.armB = [rot - bend, rot + bend];
      p.ground = true;
      p.face = 'strain';
      break;
    }
    case 'fall':
      p.legA = [18, -8];
      p.legB = [-12, -30];
      p.armA = [155, 175];
      p.armB = [-150, -172];
      p.hipY = b.thigh + b.shin;
      p.face = 'surprised';
      break;
    case 'hop':
      p.legA = [62, -10];
      p.legB = [12, -42];
      p.armA = [140, 165];
      p.armB = [-40, -10];
      p.hipY = b.thigh + b.shin - 1;
      break;
    case 'land':
      // Squash: knees deep, arms forward for balance.
      p.legA = [60, -60];
      p.legB = [50, -65];
      p.armA = [50, 85];
      p.armB = [40, 75];
      p.lean = 22;
      break;
    case 'wave':
      p.armA = [160, 150 + 26 * Math.sin(t * 12)];
      p.armB = [-5, -2];
      p.face = 'happy';
      break;
    case 'jump':
      // In the air: stretched at take-off, tucked by the top.
      p.legA = [70, -20];
      p.legB = [50, -40];
      p.armA = [150, 160];
      p.armB = [135, 150];
      p.lean = 8;
      p.hipY = b.thigh + b.shin - 2;
      p.face = 'happy';
      break;
    case 'wall': {
      // Facing the wall: hands reaching up it in turn, knees up, feet on it.
      const s = Math.sin(t * TAU * 1.3);
      p.armA = [148 + 18 * s, 170];
      p.armB = [148 - 18 * s, 170];
      p.legA = [62 + 22 * s, -25];
      p.legB = [62 - 22 * s, -25];
      p.lean = 10;
      p.hipY = b.thigh + b.shin;
      p.face = 'strain';
      break;
    }
    case 'mantle':
      p.armA = [160, 115];
      p.armB = [150, 110];
      p.legA = [80, -15];
      p.legB = [15, -10];
      p.lean = 24;
      p.hipY = b.thigh + b.shin;
      p.face = 'strain';
      break;
    case 'aim':
      // Launcher held straight up, sighting along it.
      p.armA = [176, 178];
      p.armB = [20, 70];
      p.props.launcher = true;
      p.face = 'think';
      break;
    case 'dig': {
      const s = Math.sin(t * TAU * 0.8);
      p.lean = 18 + 10 * s;
      p.armA = [55 + 15 * s, 25 + 15 * s];
      p.armB = [45 + 15 * s, 15 + 15 * s];
      p.legA = [20, 0];
      p.legB = [-8, 0];
      p.props.spade = true;
      p.face = 'strain';
      break;
    }
    case 'roll': {
      // Bent over, pushing a growing snowball along.
      p.lean = 40;
      p.armA = [80, 85];
      p.armB = [70, 80];
      p.legA = [15 + 10 * Math.sin(t * 4), 0];
      p.legB = [-15 - 10 * Math.sin(t * 4), -10];
      p.props.ball = Math.min(6, 2 + t * 0.6);
      p.face = 'strain';
      break;
    }
    case 'plant':
      p.hipY = b.thigh;
      p.legA = [75, 0];
      p.legB = [-20, -90];
      p.armA = [40, 15 + 12 * Math.sin(t * 6)];
      p.armB = [30, 10];
      p.lean = 30;
      p.face = 'happy';
      break;
    case 'tv':
      p.hipY = 0;
      p.legA = [88, 2];
      p.legB = [82, -2];
      p.armA = [40, t % 5 < 0.3 ? 100 : 80];
      p.armB = [15, 50];
      p.face = t % 4 < 0.15 ? 'blink' : 'neutral';
      break;
    case 'sofa':
      p.hipY = 0;
      p.lean = -18;
      p.legA = [85, 80];
      p.legB = [80, 75];
      p.armA = [175, -60];
      p.armB = [170, -55];
      p.face = t % 6 < 2 ? 'calm' : 'happy';
      break;
    case 'tea': {
      const sip = t % 4 < 1.2;
      p.hipY = 0;
      p.legA = [86, 4];
      p.legB = [82, 0];
      p.armA = sip ? [30, 150] : [25, 95];
      p.armB = [12, 70];
      p.props.mug = true;
      p.face = sip ? 'calm' : 'happy';
      break;
    }
    case 'eat': {
      const bite = t % 2.2 < 0.6;
      p.hipY = 0;
      p.legA = [86, 4];
      p.legB = [82, 0];
      p.armA = bite ? [35, 155] : [40, 95];
      p.armB = [30, 85];
      p.lean = 6;
      p.props.fork = true;
      p.face = bite ? 'calm' : 'happy';
      break;
    }
    case 'meditate':
      p.hipY = 3;
      p.legA = [95, -95];
      p.legB = [85, -80];
      p.armA = [25, 75];
      p.armB = [18, 70];
      p.face = 'calm';
      break;
    case 'cycle': {
      // Saddle over the back wheel, feet on the pedals (solved by IK so they
      // follow the cranks), hands on the bars.
      const crank = ((ctx.dist ?? t * 40) / (TAU * 5)) * TAU;
      const r = 2.2;
      const cx = 1.5;
      const cy = 3.5;
      p.hipY = 15;
      p.lean = 22;
      const hip = 15;
      p.legA = ik(cx + r * Math.sin(crank), hip - (cy + r * Math.cos(crank)), b);
      p.legB = ik(cx + r * Math.sin(crank + Math.PI), hip - (cy + r * Math.cos(crank + Math.PI)), b);
      p.armA = [50, 35];
      p.armB = [45, 30];
      p.props.bike = crank;
      break;
    }
    case 'puddle': {
      // Hops from foot to foot in the puddle, both feet off at the top.
      const T = t % 0.9;
      const k = Math.sin((Math.PI * T) / 0.9);
      p.lift = 5 * k;
      p.legA = [20 * k, -30 * k];
      p.legB = [30 * k, -45 * k];
      p.armA = [60 + 60 * k, 90];
      p.armB = [50 + 50 * k, 80];
      p.face = 'happy';
      break;
    }
    case 'stressed':
    case 'mad': {
      const fast = mode === 'mad' ? 3 : 1.6;
      const a = t * TAU * fast;
      const s = Math.sin(a);
      const c = Math.cos(a);
      p.legA = [18 * s, 18 * s - 40 * Math.max(0, c)];
      p.legB = [-18 * s, -18 * s - 40 * Math.max(0, -c)];
      p.armA = mode === 'mad' ? [30, 40] : [150, -150];
      p.armB = mode === 'mad' ? [20, 30] : [140, -140];
      p.lean = mode === 'mad' ? 12 : 8;
      p.face = mode;
      break;
    }
    case 'anxious':
      p.armA = [20, 100];
      p.armB = [15, 95];
      p.legA = [8, -12 * Math.abs(Math.sin(t * 10))];
      p.legB = [-2, 0];
      p.face = 'stressed';
      break;
    case 'yawn': {
      const up = yawnUp(t);
      p.armA = [mix(8, 172, up), mix(14, 178, up)];
      p.armB = [mix(-6, 160, up), mix(-2, 172, up)];
      p.lean = mix(0, -8, up);
      p.face = up > 0.4 ? 'yawn' : 'tired';
      break;
    }
    case 'surprised':
      p.armA = [60, 150];
      p.armB = [50, 140];
      p.lean = -10;
      p.lift = t < 0.25 ? 3 : 0;
      p.face = 'surprised';
      break;
    case 'celebrate':
      p.armA = [168 + 8 * Math.sin(t * 10), 176];
      p.armB = [10, 30];
      p.lift = Math.max(0, Math.sin(t * 6)) * 2;
      p.face = 'happy';
      break;
    case 'shiver':
      p.armA = [40, 120];
      p.armB = [35, 115];
      p.dx = Math.sin(t * 60) > 0 ? 0.6 : -0.4;
      p.face = 'cold';
      break;
    case 'fidget':
      p.armA = [155, -150 + 12 * Math.sin(t * 14)];
      p.armB = [-5, -2];
      p.face = 'confused';
      break;
    case 'fan':
      p.armA = [120, 160 + 20 * Math.sin(t * 16)];
      p.face = 'hot';
      break;
    case 'umbrella':
    case 'rope':
      break;
  }
  if (Number.isNaN(p.hipY)) p.hipY = Math.max(legReach(b, p.legA), legReach(b, p.legB));
  return p;
}

function frontPose(mode: Mode, t: number, b: Build, ctx: PoseContext): Pose {
  const p = base('front');
  const breath = Math.sin((t * TAU) / 4);
  p.look = ctx.look ?? 0;
  switch (mode) {
    case 'think':
      p.armB = [-40, -175];
      p.armBk = 0.45;
      p.armA = [12, -100];
      p.legA = [5, 0];
      p.legB = [3, 0];
      p.face = 'think';
      break;
    case 'yawn': {
      const up = yawnUp(t);
      p.armA = [mix(8, 150, up), mix(4, 168, up)];
      p.armB = [mix(8, 150, up), mix(4, 168, up)];
      p.lift = up > 0.9 ? 1 : 0;
      p.face = up > 0.4 ? 'yawn' : 'tired';
      break;
    }
    case 'meditate':
      p.hipY = 3;
      p.legA = [78, -100];
      p.legB = [78, -100];
      p.armA = [24, 50];
      p.armB = [24, 50];
      p.headDy = Math.sin((t * TAU) / 6) > 0.5 ? -0.6 : 0;
      p.face = 'calm';
      break;
    case 'wave':
      p.armB = [150, 140 + 26 * Math.sin(t * 12)];
      p.face = 'happy';
      break;
    case 'stressed':
      p.armA = [150, -150];
      p.armB = [150, -150];
      p.dx = Math.sin(t * 50) > 0 ? 0.6 : -0.4;
      p.face = 'stressed';
      break;
    case 'anxious':
      // Arms crossed tight, glancing one way then the other, a foot tapping.
      p.armA = [-15, -100];
      p.armB = [-15, -105];
      p.legBk = 1 - 0.12 * Math.abs(Math.sin(t * 10));
      p.look = Math.floor(t / 1.1) % 2 ? -1 : 1;
      p.face = 'stressed';
      break;
    case 'mad': {
      // Stamping one foot, fists down and shaking.
      const s = Math.max(0, Math.sin((t * TAU) / 0.7));
      p.armA = [16, 8];
      p.armB = [16, 8];
      p.legBk = 1 - 0.28 * s;
      p.dx = Math.sin(t * 40) > 0 ? 0.5 : -0.5;
      p.face = 'mad';
      break;
    }
    case 'surprised':
      p.armA = [55, 155];
      p.armB = [55, 155];
      p.lift = t < 0.25 ? 3 : 0;
      p.face = 'surprised';
      break;
    case 'celebrate':
      p.armB = [168 + 8 * Math.sin(t * 10), 176];
      p.armA = [10, 30];
      p.lift = Math.max(0, Math.sin(t * 6)) * 2;
      p.face = 'happy';
      break;
    case 'shiver':
      p.armB = [-15, -105];
      p.armA = [-15, -100];
      p.dx = Math.sin(t * 60) > 0 ? 0.6 : -0.4;
      p.legA = [2, 0];
      p.legB = [2, 0];
      p.face = 'cold';
      break;
    case 'fidget':
      p.armB = [150, -160 + 14 * Math.sin(t * 14)];
      p.face = 'confused';
      break;
    case 'fan':
      // Flapping a hand at his face.
      p.armB = [-30, -150 + 25 * Math.sin(t * 18)];
      p.armBk = 0.5;
      p.face = 'hot';
      break;
    default:
      // Stood looking out at you, breathing.
      p.armA = [8 + breath * 2, 4];
      p.armB = [8 + breath * 2, 4];
      p.headDy = breath > 0.6 ? -0.6 : 0;
      p.face = 'neutral';
  }
  if (Number.isNaN(p.hipY)) p.hipY = Math.max(legReach(b, p.legA, p.legAk), legReach(b, p.legB, p.legBk));
  return p;
}

/** The pose for `mode` at time `t`. Front view falls back to side for modes it does not draw. */
export function pose(mode: Mode, t: number, view: View = 'side', ctx: PoseContext = {}, b: Build = BUILD): Pose {
  if (view === 'back' || mode === 'rope') {
    const p = base('back');
    p.hipY = b.thigh + b.shin;
    // Hand over hand: t drives the alternation.
    const s = Math.sin(t * TAU * 1.4);
    p.armA = [170 + 6 * s, 178];
    p.armB = [170 - 6 * s, 178];
    p.armAk = 0.75 + 0.2 * s;
    p.armBk = 0.75 - 0.2 * s;
    p.legA = [20 + 15 * Math.max(0, s), -20];
    p.legB = [20 + 15 * Math.max(0, -s), -20];
    p.legAk = 1 - 0.25 * Math.max(0, s);
    p.legBk = 1 - 0.25 * Math.max(0, -s);
    return p;
  }
  return view === 'front' && FRONT_MODES.includes(mode) ? frontPose(mode, t, b, ctx) : sidePose(mode, t, b, ctx);
}

const NUMS = ['hipY', 'lean', 'rot', 'dx', 'dy', 'lift', 'headDy', 'legAk', 'legBk', 'armAk', 'armBk', 'look'] as const;
const PAIRS = ['legA', 'legB', 'armA', 'armB'] as const;

/** Ease from one pose into another, k from 0 to 1. Different views do not blend. */
export function blend(a: Pose | null, b: Pose, k: number): Pose {
  if (!a || k >= 1 || a.view !== b.view) return b;
  const o: Pose = { ...b };
  for (const n of NUMS) o[n] = mix(a[n], b[n], k);
  for (const n of PAIRS) o[n] = [mix(a[n][0], b[n][0], k), mix(a[n][1], b[n][1], k)];
  if (k < 0.5) {
    o.face = a.face;
    o.props = a.props;
  }
  return o;
}

// ---------------------------------------------------------------- raster

interface Raster {
  map: Map<string, Pixel>;
  tf: (x: number, y: number) => [number, number];
  put: (x: number, y: number, c: string) => void;
  line: (x0: number, y0: number, x1: number, y1: number, c: string, w?: number) => void;
  sprite: (rows: string[], x0: number, y0: number, key: Record<string, string>) => void;
}

function raster(rot: number, dx: number, dy: number): Raster {
  const map = new Map<string, Pixel>();
  const cr = Math.cos(rot * DEG);
  const sr = Math.sin(rot * DEG);
  const tf = (x: number, y: number): [number, number] => [Math.round(x * cr - y * sr + dx) || 0, Math.round(x * sr + y * cr + dy) || 0];
  const set = (X: number, Y: number, c: string) => map.set(`${X},${Y}`, [X, Y, c]);
  const put = (x: number, y: number, c: string) => {
    const [X, Y] = tf(x, y);
    set(X, Y, c);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string, w = 1) => {
    let [a, bb] = tf(x0, y0);
    const [ex, ey] = tf(x1, y1);
    const ddx = Math.abs(ex - a);
    const sx = a < ex ? 1 : -1;
    const ddy = -Math.abs(ey - bb);
    const sy = bb < ey ? 1 : -1;
    const vertical = -ddy >= ddx;
    let err = ddx + ddy;
    for (let g = 0; g < 160; g++) {
      set(a, bb, c);
      if (w >= 2) vertical ? set(a - 1, bb, c) : set(a, bb - 1, c);
      if (w >= 3) vertical ? set(a + 1, bb, c) : set(a, bb + 1, c);
      if (a === ex && bb === ey) break;
      const e2 = 2 * err;
      if (e2 >= ddy) {
        err += ddy;
        a += sx;
      }
      if (e2 <= ddx) {
        err += ddx;
        bb += sy;
      }
    }
  };
  const sprite = (rows: string[], x0: number, y0: number, key: Record<string, string>) =>
    rows.forEach((row, r) => [...row].forEach((ch, c) => key[ch] && put(x0 + c, y0 + r, key[ch])));
  return { map, tf, put, line, sprite };
}

/** Lift, mirror and outline: every empty cell touching the figure gets ink. */
function finish(map: Map<string, Pixel>, p: Pose, dir: 1 | -1, pal: Palette) {
  let px = [...map.values()];
  let shift = -Math.round(p.lift);
  if (p.ground) shift -= Math.max(...px.map((q) => q[1]));
  if (shift) px = px.map(([x, y, c]) => [x, y + shift, c]);
  if (dir === -1) px = px.map(([x, y, c]) => [-x || 0, y, c]);
  const filled = new Set(px.map(([x, y]) => `${x},${y}`));
  const out: Pixel[] = [];
  for (const [x, y] of px)
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = `${x + ox},${y + oy}`;
      if (!filled.has(k)) {
        filled.add(k);
        out.push([x + ox, y + oy, pal.ink]);
      }
    }
  return { px: out.concat(px), shift };
}

export interface Extras {
  /** Scarf tail points (side view, art units from the feet), or true for the front view. */
  scarf?: Pair[] | boolean;
  /** Sway of the front scarf tail. */
  scarfSway?: number;
  /** The hair tuft's offset from rest, from its spring. */
  hairTip?: Pair;
  /** Arm angles that hold an umbrella up, whatever else he is doing. */
  umbrella?: boolean;
}

const UMBRELLA_ARM: Pair = [165, 176];
const BIKE = { frame: '#2f8f86', frameD: '#1f655e', tyre: '#1d1916', hub: '#9a948c' };

function drawSide(p: Pose, dir: 1 | -1, b: Build, pal: Palette, ex: Extras): Figure {
  const R = raster(p.rot, p.dx, p.dy);
  const { put, line, sprite } = R;
  const vec = (a: number, len: number): Pair => [Math.sin(a * DEG) * len, Math.cos(a * DEG) * len];
  const hip: Pair = [0, -p.hipY];
  const td: Pair = [Math.sin(p.lean * DEG), -Math.cos(p.lean * DEG)];
  const at = (k: number): Pair => [hip[0] + td[0] * k, hip[1] + td[1] * k];
  const neck = at(b.torso);
  const sh = at(b.torso - 2);
  const limb = (root: Pair, ang: Pair, l1: number, l2: number, c: string, end: string | null, w: number, k = 1): Pair => {
    const [ax, ay] = vec(ang[0], l1 * k);
    const [bx, by] = vec(ang[1], l2 * k);
    const kn: Pair = [root[0] + ax, root[1] + ay];
    const e: Pair = [kn[0] + bx, kn[1] + by];
    line(root[0], root[1], kn[0], kn[1], c, w);
    line(kn[0], kn[1], e[0], e[1], c, w);
    if (end === null) {
      for (let i = -1; i <= 2; i++) put(e[0] + i, e[1], pal.shoe);
      put(e[0] + 3, e[1], pal.sole);
      for (let i = -1; i <= 1; i++) put(e[0] + i, e[1] - 1, pal.shoe);
    } else {
      put(e[0], e[1], end);
      put(e[0] + 1, e[1], end);
      put(e[0], e[1] + 1, end);
      put(e[0] + 1, e[1] + 1, end);
    }
    return e;
  };
  const armA = ex.umbrella ? UMBRELLA_ARM : p.armA;

  // The bike goes behind him.
  if (p.props.bike !== undefined) {
    const wheel = (cx: number) => {
      for (let a = 0; a < 24; a++) put(cx + 5 * Math.cos((a / 24) * TAU), -5 + 5 * Math.sin((a / 24) * TAU), BIKE.tyre);
      const s = p.props.bike!;
      line(cx, -5, cx + 4 * Math.cos(s), -5 + 4 * Math.sin(s), BIKE.hub);
    };
    wheel(-8);
    wheel(9);
    line(-8, -5, 1.5, -3.5, BIKE.frame, 2);
    line(1.5, -3.5, 7, -12, BIKE.frame, 2);
    line(-8, -5, -3, -13, BIKE.frameD, 2);
    line(-3, -13, 7, -12, BIKE.frame, 2);
    line(7, -12, 9, -5, BIKE.frameD, 2);
    line(7, -12, 9, -16, BIKE.frameD);
    line(8, -16, 11, -16, pal.shoe, 2);
    line(-5, -14, -1, -14, pal.shoe, 2);
  }

  limb(sh, p.armB, b.upper, b.fore, pal.shirtD, pal.skinD, 2, p.armBk);
  limb(hip, p.legB, b.thigh, b.shin, pal.legsD, null, 3, p.legBk);
  if (Array.isArray(ex.scarf)) {
    let prev: Pair = [neck[0] - 2, neck[1]];
    ex.scarf.forEach((pt, i) => {
      line(prev[0], prev[1], pt[0], pt[1], i % 2 ? pal.scarfD : pal.scarf, 2);
      prev = pt;
    });
  }
  for (let k = 0; k <= b.torso; k += 0.5) {
    const [x, y] = at(k);
    put(x - 3, y, pal.shirtD);
    put(x - 2, y, pal.shirt);
    put(x - 1, y, pal.shirt);
    put(x, y, pal.shirt);
    put(x + 1, y, pal.shirt);
    put(x + 2, y, k > b.torso - 4 ? pal.shirtL : pal.shirt);
  }
  for (let i = -3; i <= 2; i++) put(hip[0] + i, hip[1], pal.legsD);
  put(neck[0], neck[1], pal.collar);
  put(neck[0] + 1, neck[1], pal.collar);
  put(neck[0] - 1, neck[1], pal.skinD);
  put(neck[0], neck[1] - 1, pal.skinD);
  const hx = Math.round(neck[0] + td[0] - SIDE_NECK);
  const hy = Math.round(neck[1] - 1 - SIDE_HEAD.length + p.headDy);
  sprite(SIDE_HEAD, hx, hy, { H: pal.hair, L: pal.hairL, s: pal.skin, d: pal.skinD });
  const tip = ex.hairTip ?? [0, 0];
  put(hx - 1 + Math.round(tip[0]), hy + 3 + Math.round(tip[1]), pal.hair);
  put(hx - 1 + Math.round(tip[0]), hy + 4 + Math.round(tip[1]), pal.hair);
  put(hx + 11, hy + 8, pal.skin);
  for (const [c, r, k] of sideFace(p.face)) put(hx + c, hy + r, pal[k]);
  if (p.props.paper) for (let c = 6; c <= 12; c++) for (let r = 2; r <= 9; r++) put(hx + c, hy + r, r % 3 ? '#efe9dc' : '#9a948c');
  if (ex.scarf) for (let i = -3; i <= 2; i++) {
    put(neck[0] + i, neck[1], i % 2 ? pal.scarfD : pal.scarf);
    put(neck[0] + i, neck[1] + 1, pal.scarf);
  }
  limb(hip, p.legA, b.thigh, b.shin, pal.legs, null, 3, p.legAk);
  const hand = limb(sh, armA, b.upper, b.fore, pal.shirtL, pal.skin, 2, p.armAk);
  const pr = p.props;
  if (pr.mug) {
    for (let i = 1; i <= 3; i++) for (let j = -3; j <= -1; j++) put(hand[0] + i, hand[1] + j, pal.collar);
    put(hand[0] + 4, hand[1] - 2, pal.shirt);
  }
  if (pr.fork) {
    line(hand[0] + 1, hand[1], hand[0] + 3, hand[1] - 4, '#9a948c');
  }
  if (pr.spade) {
    line(hand[0], hand[1], hand[0] + 3, 0, '#7a5230', 2);
    for (let i = 2; i <= 5; i++) put(hand[0] + i, 0, '#8c8780');
    put(hand[0] + 3, -1, '#8c8780');
    put(hand[0] + 4, -1, '#8c8780');
  }
  if (pr.launcher) for (let j = 1; j <= 4; j++) {
    put(hand[0], hand[1] - j, '#4a4440');
    put(hand[0] + 1, hand[1] - j, j > 2 ? '#4a4440' : '#6a6460');
  }
  if (pr.telescope) {
    line(hand[0] - 2, hand[1] + 1, hand[0] + 6, hand[1] - 5, '#3a5f9a', 2);
    put(hand[0] + 7, hand[1] - 6, '#bfe3e6');
  }
  if (pr.book) {
    const page = pr.page ?? 0;
    for (let i = 0; i <= 3; i++) for (let j = -3; j <= 0; j++) put(hand[0] + i, hand[1] + j, '#7a2f0a');
    for (let j = -2; j <= -1; j++) {
      put(hand[0] + 1, hand[1] + j, page ? '#f4ecdf' : '#e6dccb');
      put(hand[0] + 2, hand[1] + j, page ? '#e6dccb' : '#f4ecdf');
    }
  }
  if (pr.ball) {
    const r = pr.ball;
    const cx = hand[0] + r + 1;
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (x * x + y * y <= r * r) put(cx + x, -r + y, x + y < -r / 2 ? '#ffffff' : '#e3e8ee');
  }
  if (pr.skip !== undefined) {
    // Side on, the rope is a narrow loop from the hands to its far point.
    const cy = -(p.hipY + b.torso) / 2 - 1;
    const ry = (p.hipY + b.torso + 10) / 2 + 1;
    const tip: Pair = [0.5 + 7 * Math.sin(pr.skip), Math.min(p.lift, cy + ry * Math.cos(pr.skip))];
    line(hand[0], hand[1], tip[0], tip[1], '#2a2420');
  }
  const f = finish(R.map, p, dir, pal);
  const flip = (q: Pair): [number, number] => [q[0] * dir, q[1] + f.shift];
  const [HX, HY] = R.tf(hx + 6, hy + 5);
  const [CX, CY] = R.tf(hx + 5, hy);
  const [AX, AY] = R.tf(hand[0], hand[1]);
  return { px: f.px, head: flip([HX, HY]), crown: flip([CX, CY]), hand: flip([AX, AY]), top: Math.min(...f.px.map((q) => q[1])) };
}

function drawFront(p: Pose, dir: 1 | -1, b: Build, pal: Palette, ex: Extras): Figure {
  const R = raster(0, p.dx, 0);
  const { put, line, sprite } = R;
  const back = p.view === 'back';
  const sq = 1 - 0.3 * p.yaw;
  const hipY = -p.hipY;
  const neckY = hipY - b.torso;
  const shY = neckY + 2;
  const limb = (rx: number, ry: number, side: number, ang: Pair, l1: number, l2: number, c: string, end: string | null, w: number, k = 1, k1 = 1): Pair => {
    const kx = rx + side * Math.sin(ang[0] * DEG) * l1 * k * k1;
    const ky = ry + Math.cos(ang[0] * DEG) * l1 * k * k1;
    const ex2 = kx + side * Math.sin(ang[1] * DEG) * l2 * k;
    const ey2 = ky + Math.cos(ang[1] * DEG) * l2 * k;
    line(rx, ry, kx, ky, c, w);
    line(kx, ky, ex2, ey2, c, w);
    if (end === null) {
      for (let i = -1; i <= 1; i++) put(ex2 + i, ey2, pal.shoe);
      put(ex2 + side * 2, ey2, pal.shoe);
      for (let i = -1; i <= 1; i++) put(ex2 + i, ey2 - 1, pal.shoe);
    } else {
      put(ex2, ey2, end);
      put(ex2 + side, ey2, end);
      put(ex2, ey2 + 1, end);
      put(ex2 + side, ey2 + 1, end);
    }
    return [ex2, ey2];
  };
  limb(-2 * sq, hipY, -1, p.legA, b.thigh, b.shin, pal.legs, null, 3, p.legAk);
  limb(2 * sq, hipY, 1, p.legB, b.thigh, b.shin, pal.legsD, null, 3, p.legBk);
  // Torso: wider at the shoulders, lit from his left.
  for (let k = 0; k <= b.torso; k++) {
    const y = hipY - k;
    const hw = Math.round((3.4 + (k / b.torso) * 1.6) * sq);
    for (let x = -hw; x <= hw; x++) put(x, y, x === -hw ? pal.shirtL : x === hw ? pal.shirtD : pal.shirt);
  }
  for (let x = -3; x <= 3; x++) put(x * sq, hipY, pal.legsD);
  if (!back) {
    put(0, neckY, pal.collar);
    put(-1, neckY, pal.collar);
    put(1, neckY, pal.collar);
    put(0, neckY + 1, pal.collar);
  }
  put(0, neckY - 1, pal.skinD);
  put(-1, neckY - 1, pal.skin);
  put(1, neckY - 1, pal.skinD);
  if (ex.scarf) {
    for (let x = -3; x <= 3; x++) {
      put(x, neckY, x % 2 ? pal.scarfD : pal.scarf);
      put(x, neckY - 1, pal.scarf);
    }
    const sway = ex.scarfSway ?? 0;
    for (let j = 1; j <= 6; j++) {
      put(2 + Math.round((sway * j) / 6), neckY + j, j % 2 ? pal.scarf : pal.scarfD);
      put(3 + Math.round((sway * j) / 6), neckY + j, pal.scarf);
    }
  }
  const hx = -FRONT_NECK;
  const hy = Math.round(neckY - 1 - FRONT_HEAD.length + p.headDy);
  const key = { H: pal.hair, L: pal.hairL, s: pal.skin, d: pal.skinD };
  sprite(back ? BACK_HEAD : FRONT_HEAD, hx, hy, key);
  const turn = Math.round(2 * p.yaw);
  if (turn) {
    put(hx, hy + 6, pal.hair);
    put(hx, hy + 7, pal.hair);
  }
  const tip = ex.hairTip ?? [0, 0];
  put(hx + 6 + Math.round(tip[0]), hy - 1 + Math.round(tip[1] * 0.5), pal.hair);
  if (!back) for (const [c, r, k] of frontFace(p.face, p.look)) put(hx + Math.min(10, c + turn), hy + r, pal[k]);
  // Arms last: they cross the body and reach the head.
  limb(-4.6 * sq, shY, -1, p.armA, b.upper, b.fore, pal.shirtL, pal.skin, 2, 1, p.armAk);
  const hand = limb(4.6 * sq, shY, 1, ex.umbrella ? [170, 178] : p.armB, b.upper, b.fore, pal.shirtD, pal.skinD, 2, 1, p.armBk);
  const f = finish(R.map, p, dir, pal);
  return {
    px: f.px,
    head: [0, hy + 5 + f.shift],
    crown: [0, hy + f.shift],
    hand: [Math.round(hand[0]) * dir, Math.round(hand[1]) + f.shift],
    top: Math.min(...f.px.map((q) => q[1])),
  };
}

/** Draw a pose facing `dir` (1 right, -1 left; ignored front on). */
export function render(p: Pose, dir: 1 | -1 = 1, ex: Extras = {}, b: Build = BUILD, pal: Palette = PALETTE): Figure {
  return p.view === 'side' ? drawSide(p, dir, b, pal, ex) : drawFront(p, 1, b, pal, ex);
}

/** The character in `mode` at time `t`, side on unless `view` says otherwise. */
export function figure(mode: Mode, t: number, dir: 1 | -1, view: View = 'side', ctx: PoseContext = {}): Figure {
  return render(pose(mode, t, view, ctx), dir);
}

// ---------------------------------------------------------------- car

const CAR = {
  body: '#2f8f86',
  bodyD: '#1f655e',
  glass: '#bfe3e6',
  tyre: '#1d1916',
  hub: '#9a948c',
  lamp: '#ffd77a',
  tail: '#d2402a',
};

/**
 * The car, origin at the middle of its wheelbase on the road, in prop units
 * (two art pixels each). With a driver, his head shows through the side window.
 */
export function car(dir: 1 | -1, t: number, moving: boolean, driver: Palette | null, shake = 0): Pixel[] {
  const out: Pixel[] = [];
  const jolt = shake ? (Math.floor(t * 30) % 2 ? 1 : 0) : 0;
  const put = (x: number, y: number, c: string) => out.push([x * dir || 0, y - (y < -1 ? jolt : 0), c]);
  for (let x = -4; x <= 3; x++) put(x, -9, CAR.body);
  for (let y = -8; y <= -6; y++) for (let x = -5; x <= 4; x++) put(x, y, x === -5 || x === 4 || x === 0 ? CAR.body : CAR.glass);
  if (driver) {
    put(1, -8, driver.hair);
    put(2, -8, driver.hair);
    put(3, -8, driver.hair);
    put(1, -7, driver.hair);
    put(2, -7, driver.skin);
    put(3, -7, driver.eye);
    put(2, -6, driver.skin);
    put(3, -6, driver.skin);
  }
  for (let y = -5; y <= -2; y++) for (let x = -8; x <= 7; x++) put(x, y, y === -2 ? CAR.bodyD : CAR.body);
  put(7, -4, CAR.lamp);
  put(-8, -4, CAR.tail);
  put(-1, -4, CAR.bodyD);
  const spin = moving ? Math.floor(t * 12) % 2 : 0;
  for (const cx of [-5, 4]) {
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = -2; y <= 0; y++) put(x, y, CAR.tyre);
    put(cx, spin ? -2 : -1, CAR.hub);
  }
  return out;
}

/** 3×5 pixel glyphs: Zs, and the symbols for grawlix and emanata. */
export const GLYPHS: Record<string, string[]> = {
  z: ['###', '..#', '.#.', '#..', '###'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '@': ['.##', '#.#', '###', '#..', '.##'],
  '*': ['...', '#.#', '.#.', '#.#', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  '.': ['...', '...', '...', '...', '.#.'],
};
