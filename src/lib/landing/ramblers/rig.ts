// The rambler's body: a small side-on skeleton rasterised to art pixels every
// frame. A pose is a handful of joint angles, so limbs bend at real knees and
// elbows and feet stay planted. Pure: no DOM, no canvas — the overlay scales
// these pixels up and paints them.
//
// Coordinates are art units with the origin at the feet: +x is the way the
// character faces, +y is down. Angles are degrees: 0 points down, 90 points
// forward, 180 points up.

export type Mode =
  | 'idle'
  | 'walk'
  | 'run'
  | 'lookout'
  | 'study'
  | 'think'
  | 'sleep'
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
  | 'tv'
  | 'sofa'
  | 'stressed'
  | 'anxious'
  | 'umbrella';

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
  shirt: string;
  shirtD: string;
  legs: string;
  legsD: string;
  shoe: string;
  eye: string;
}

export type Pixel = [x: number, y: number, colour: string];

export interface Figure {
  px: Pixel[];
  /** The near hand, where anything he holds up is drawn. */
  hand: [number, number];
  /** Centre of the head, for bubbles and Zs. */
  head: [number, number];
  /** Topmost occupied row (negative: above the feet). */
  top: number;
}

export const BUILD: Build = { thigh: 4, shin: 3, torso: 6, upper: 3, fore: 3 };

export const PALETTE: Palette = {
  skin: '#e9b48c',
  skinD: '#c38a63',
  hair: '#5a3418',
  shirt: '#d4621a',
  shirtD: '#9c4510',
  legs: '#4a5f8c',
  legsD: '#33436a',
  shoe: '#2a2420',
  eye: '#1d1209',
};

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

interface Pose {
  hipY: number | null;
  lean: number;
  nL: [number, number];
  fL: [number, number];
  nA: [number, number];
  fA: [number, number];
  eye: 0 | 1;
  look: number;
  rot: number;
  dx: number;
  dy: number;
  /** Rest the lowest pixel on the floor after rotating (push-ups). */
  ground: boolean;
  lift: number;
  book: boolean;
  rope: number | null;
  launcher: boolean;
  spade: boolean;
}

const legReach = (b: Build, l: [number, number]) => b.thigh * Math.cos(l[0] * DEG) + b.shin * Math.cos(l[1] * DEG);

function poseFor(mode: Mode, t: number, b: Build): Pose {
  const p: Pose = {
    hipY: null,
    lean: 0,
    nL: [3, 0],
    fL: [-3, 0],
    nA: [6, 10],
    fA: [-6, -2],
    eye: t % 3.7 < 0.13 ? 0 : 1,
    look: 0,
    rot: 0,
    dx: 0,
    dy: 0,
    ground: false,
    lift: 0,
    book: false,
    rope: null,
    launcher: false,
    spade: false,
  };
  switch (mode) {
    case 'idle': {
      const br = Math.sin(t * 2.2);
      p.nA = [5 + br * 3, 12];
      p.fA = [-5 - br * 3, -2];
      break;
    }
    case 'walk': {
      const a = t * TAU * 1.7;
      const s = Math.sin(a);
      const c = Math.cos(a);
      p.nL = [30 * s, 30 * s - 45 * Math.max(0, c)];
      p.fL = [-30 * s, -30 * s - 45 * Math.max(0, -c)];
      p.nA = [-28 * s, -28 * s + 22];
      p.fA = [28 * s, 28 * s + 22];
      p.lean = 4;
      break;
    }
    case 'run': {
      const a = t * TAU * 2.6;
      const s = Math.sin(a);
      const c = Math.cos(a);
      p.nL = [12 + 45 * s, 12 + 45 * s - (25 + 70 * Math.max(0, c))];
      p.fL = [12 - 45 * s, 12 - 45 * s - (25 + 70 * Math.max(0, -c))];
      p.nA = [-55 * s, -55 * s + 90];
      p.fA = [55 * s, 55 * s + 90];
      p.lean = 14;
      break;
    }
    case 'lookout': {
      const w = 16 * Math.sin(t * 3);
      p.hipY = 0;
      p.nL = [88, 6 + w];
      p.fL = [82, 4 - w];
      p.nA = [18, 62];
      p.fA = [12, 52];
      break;
    }
    case 'study': {
      p.hipY = 0;
      p.nL = [88, 2];
      p.fL = [82, -2];
      p.nA = [22, 105];
      p.fA = [12, 98];
      p.book = true;
      p.look = 1;
      p.lean = 6;
      break;
    }
    case 'think': {
      // Hand to chin, eyes up, weight shifting from foot to foot.
      const sway = Math.sin(t * 1.3);
      p.nL = [2 + sway * 2, 0];
      p.fL = [-3 + sway * 2, 0];
      p.nA = [28, 168];
      p.fA = [20, 75];
      p.look = -1;
      break;
    }
    case 'sleep': {
      p.nL = [0, 0];
      p.fL = [3, 3];
      p.nA = [3, 3];
      p.fA = [-3, -3];
      p.hipY = b.thigh + b.shin;
      p.rot = -90;
      p.dy = -2;
      p.eye = 0;
      p.dx = Math.round((b.thigh + b.shin + b.torso + 4) / 2);
      break;
    }
    case 'skip': {
      // Skipping rope: the hop peaks as the rope passes under the feet.
      const a = t * TAU * 1.6;
      p.rope = a;
      p.lift = Math.round(2 * Math.max(0, Math.cos(a)));
      p.nL = p.lift ? [28, -22] : [8, -4];
      p.fL = p.lift ? [18, -30] : [2, -8];
      p.nA = [25, 70];
      p.fA = [15, 65];
      break;
    }
    case 'pushup': {
      const u = (Math.sin(t * TAU * 0.7) + 1) / 2; // 1 = arms straight
      const bend = 45 * (1 - u);
      const reach = b.upper * Math.cos(bend * DEG) + b.fore * Math.cos(bend * DEG);
      const shoulder = b.thigh + b.shin + b.torso - 1;
      const rot = 90 - Math.asin(Math.min(1, reach / shoulder)) / DEG;
      p.hipY = b.thigh + b.shin;
      p.nL = [0, 0];
      p.fL = [0, 0];
      p.rot = rot;
      p.nA = [rot - bend, rot + bend];
      p.fA = [rot - bend, rot + bend];
      p.ground = true;
      break;
    }
    case 'fall':
      p.nL = [18, -8];
      p.fL = [-12, -30];
      p.nA = [155, 175];
      p.fA = [-150, -172];
      p.hipY = b.thigh + b.shin;
      break;
    case 'hop':
      p.nL = [62, -10];
      p.fL = [12, -42];
      p.nA = [140, 165];
      p.fA = [-40, -10];
      p.hipY = b.thigh + b.shin - 1;
      break;
    case 'land':
      p.nL = [50, -40];
      p.fL = [40, -45];
      p.nA = [35, 70];
      p.fA = [25, 60];
      p.lean = 14;
      break;
    case 'wave':
      p.nA = [165, 160 + 28 * Math.sin(t * 13)];
      p.fA = [-5, -2];
      break;
    case 'jump':
      p.nL = [48, -28];
      p.fL = [22, -48];
      p.nA = [165, 172];
      p.fA = [150, 165];
      p.hipY = b.thigh + b.shin;
      break;
    case 'wall': {
      // Facing the wall: hands reaching up it in turn, knees up, feet on it.
      const s = Math.sin(t * TAU * 1.3);
      p.nA = [148 + 18 * s, 170];
      p.fA = [148 - 18 * s, 170];
      p.nL = [62 + 22 * s, -25];
      p.fL = [62 - 22 * s, -25];
      p.lean = 10;
      p.hipY = b.thigh + b.shin;
      break;
    }
    case 'mantle':
      // Hands on the ledge, one knee coming up over it.
      p.nA = [160, 115];
      p.fA = [150, 110];
      p.nL = [80, -15];
      p.fL = [15, -10];
      p.lean = 24;
      p.hipY = b.thigh + b.shin;
      break;
    case 'aim':
      // Launcher held straight up, sighting along it.
      p.nA = [176, 178];
      p.fA = [20, 70];
      p.look = -1;
      p.launcher = true;
      break;
    case 'rope':
      break;
    case 'dig': {
      // Spade in, lean on it, lever the soil up and out.
      const s = Math.sin(t * TAU * 0.8);
      p.lean = 18 + 10 * s;
      p.nA = [55 + 15 * s, 25 + 15 * s];
      p.fA = [45 + 15 * s, 15 + 15 * s];
      p.nL = [20, 0];
      p.fL = [-8, 0];
      p.look = 1;
      p.spade = true;
      break;
    }
    case 'plant': {
      // One knee down, patting the soil round a seedling.
      p.hipY = b.thigh;
      p.nL = [75, 0];
      p.fL = [-20, -90];
      p.nA = [40, 15 + 12 * Math.sin(t * 6)];
      p.fA = [30, 10];
      p.lean = 30;
      p.look = 1;
      break;
    }
    case 'tv': {
      p.hipY = 0;
      p.nL = [88, 2];
      p.fL = [82, -2];
      // Remote held out; now and then a click.
      p.nA = [40, t % 5 < 0.3 ? 100 : 80];
      p.fA = [15, 50];
      break;
    }
    case 'sofa':
      // Reclined, feet out, hands behind his head.
      p.hipY = 0;
      p.lean = -18;
      p.nL = [85, 80];
      p.fL = [80, 75];
      p.nA = [175, -60];
      p.fA = [170, -55];
      p.eye = t % 6 < 2 ? 0 : p.eye;
      break;
    case 'stressed': {
      // Pacing quickly, hands clamped on his head.
      const a = t * TAU * 2.4;
      const s = Math.sin(a);
      const c = Math.cos(a);
      p.nL = [26 * s, 26 * s - 40 * Math.max(0, c)];
      p.fL = [-26 * s, -26 * s - 40 * Math.max(0, -c)];
      p.nA = [150, -150];
      p.fA = [140, -140];
      p.lean = 8;
      break;
    }
    case 'anxious':
      // Arms crossed tight, one foot tapping.
      p.nA = [20, 100];
      p.fA = [15, 95];
      p.nL = [8, -12 * Math.abs(Math.sin(t * 10))];
      p.fL = [-2, 0];
      p.look = Math.floor(t * 2) % 3 === 0 ? 1 : 0;
      break;
    case 'umbrella':
      break;
  }
  if (p.hipY === null) p.hipY = Math.max(legReach(b, p.nL), legReach(b, p.fL));
  return p;
}

/** Arm angles for holding an umbrella up, whatever the legs are doing. */
const UMBRELLA_ARM: [number, number] = [165, 176];

/** The character in `mode` at time `t`, facing `dir` (1 right, -1 left). */
export function figure(mode: Mode, t: number, dir: 1 | -1, b: Build = BUILD, pal: Palette = PALETTE, umbrella = false): Figure {
  if (mode === 'rope') return climbFigure(t, b, pal);
  const p = poseFor(mode, t, b);
  if (umbrella || mode === 'umbrella') p.nA = UMBRELLA_ARM;
  const map = new Map<string, Pixel>();
  const cr = Math.cos(p.rot * DEG);
  const sr = Math.sin(p.rot * DEG);
  const tf = (x: number, y: number): [number, number] => {
    const rx = x * cr - y * sr + p.dx;
    const ry = x * sr + y * cr + p.dy;
    return [Math.round(rx * dir) || 0, Math.round(ry) || 0];
  };
  const set = (X: number, Y: number, c: string) => map.set(`${X},${Y}`, [X, Y, c]);
  const put = (x: number, y: number, c: string) => {
    const [X, Y] = tf(x, y);
    set(X, Y, c);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    let [a, b2] = tf(x0, y0);
    const [ex, ey] = tf(x1, y1);
    const dx = Math.abs(ex - a);
    const sx = a < ex ? 1 : -1;
    const dy = -Math.abs(ey - b2);
    const sy = b2 < ey ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 64; guard++) {
      set(a, b2, c);
      if (a === ex && b2 === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        a += sx;
      }
      if (e2 <= dx) {
        err += dx;
        b2 += sy;
      }
    }
  };
  const vec = (a: number, len: number): [number, number] => [Math.sin(a * DEG) * len, Math.cos(a * DEG) * len];
  const hip: [number, number] = [0, -p.hipY!];
  const td: [number, number] = [Math.sin(p.lean * DEG), -Math.cos(p.lean * DEG)];
  const neck: [number, number] = [hip[0] + td[0] * b.torso, hip[1] + td[1] * b.torso];
  const sh: [number, number] = [hip[0] + td[0] * (b.torso - 1), hip[1] + td[1] * (b.torso - 1)];
  const hc: [number, number] = [neck[0] + td[0] * 2 + 0.3, neck[1] + td[1] * 2];
  const limb = (root: [number, number], ang: [number, number], l1: number, l2: number, c: string, end: string, foot: boolean) => {
    const [ax, ay] = vec(ang[0], l1);
    const [bx, by] = vec(ang[1], l2);
    const k: [number, number] = [root[0] + ax, root[1] + ay];
    const e: [number, number] = [k[0] + bx, k[1] + by];
    line(root[0], root[1], k[0], k[1], c);
    line(k[0], k[1], e[0], e[1], c);
    put(e[0], e[1], end);
    if (foot) put(e[0] + 1, e[1], end);
    return e;
  };
  // Far side first, then the body, then the near side on top.
  const farHand = limb(sh, p.fA, b.upper, b.fore, pal.shirtD, pal.skinD, false);
  limb(hip, p.fL, b.thigh, b.shin, pal.legsD, pal.shoe, true);
  line(hip[0], hip[1], neck[0], neck[1], pal.shirt);
  line(hip[0] - 1, hip[1], neck[0] - 1, neck[1], pal.shirt);
  put(hip[0], hip[1], pal.legs);
  put(hip[0] - 1, hip[1], pal.legs);
  const hx = Math.round(hc[0]);
  const hy = Math.round(hc[1]);
  for (let i = -2; i <= 1; i++) for (let j = -2; j <= 1; j++) put(hx + i, hy + j, pal.skin);
  for (let i = -2; i <= 1; i++) put(hx + i, hy - 2, pal.hair);
  put(hx - 2, hy - 1, pal.hair);
  put(hx + 1, hy + p.look, p.eye ? pal.eye : pal.skinD);
  limb(hip, p.nL, b.thigh, b.shin, pal.legs, pal.shoe, true);
  const hand = limb(sh, p.nA, b.upper, b.fore, pal.shirt, pal.skin, false);
  if (p.spade) {
    // Handle from his hands down to the blade, which bites the ground ahead.
    line(hand[0], hand[1], hand[0] + 2, 0, '#7a5230');
    put(hand[0] + 2, 0, '#8c8780');
    put(hand[0] + 3, 0, '#8c8780');
    put(hand[0] + 2, -1, '#8c8780');
  }
  if (p.launcher) {
    put(hand[0], hand[1] - 1, '#4a4440');
    put(hand[0], hand[1] - 2, '#4a4440');
    put(hand[0] + 1, hand[1] - 1, '#4a4440');
  }
  if (p.book) {
    const page = Math.floor(t / 2.6) % 2;
    for (let i = 0; i <= 2; i++) for (let j = -2; j <= 0; j++) put(hand[0] + i, hand[1] + j, '#7a2f0a');
    put(hand[0] + 1, hand[1] - 1, page ? '#f4ecdf' : '#e6dccb');
    put(hand[0] + 2, hand[1] - 1, page ? '#e6dccb' : '#f4ecdf');
    put(hand[0], hand[1], pal.skin);
  }
  if (p.rope !== null) {
    // Side on, the rope is a narrow loop from the hands out to its far point,
    // which circles the body: over the head, out in front, under the feet.
    const cy = -(p.hipY! + b.torso) / 2 - 1;
    const ry = (p.hipY! + b.torso + 5) / 2 + 1;
    const tip: [number, number] = [0.5 + 5 * Math.sin(p.rope), Math.min(p.lift, cy + ry * Math.cos(p.rope))];
    const grip: [number, number] = [(hand[0] + farHand[0]) / 2 + 1, (hand[1] + farHand[1]) / 2];
    const len = Math.hypot(tip[0] - grip[0], tip[1] - grip[1]) || 1;
    const off: [number, number] = [(-(tip[1] - grip[1]) / len) * 1.5, ((tip[0] - grip[0]) / len) * 1.5];
    const mid: [number, number] = [(grip[0] + tip[0]) / 2, (grip[1] + tip[1]) / 2];
    for (const sgn of [1, -1]) {
      line(grip[0], grip[1], mid[0] + off[0] * sgn, mid[1] + off[1] * sgn, '#2a2420');
      line(mid[0] + off[0] * sgn, mid[1] + off[1] * sgn, tip[0], tip[1], '#2a2420');
    }
  }
  let px = [...map.values()];
  let shift = -p.lift;
  if (p.ground) shift -= Math.max(...px.map((q) => q[1]));
  if (shift) px = px.map(([x, y, c]) => [x, y + shift, c]);
  const [headX, headY] = tf(hc[0], hc[1]);
  const [handX, handY] = tf(hand[0], hand[1]);
  return { px, head: [headX, headY + shift], hand: [handX, handY + shift], top: Math.min(...px.map((q) => q[1])) };
}

/** Seen from behind on a rope: hand over hand, feet gripping below. */
function climbFigure(t: number, b: Build, pal: Palette): Figure {
  const map = new Map<string, Pixel>();
  const put = (x: number, y: number, c: string) => map.set(`${x},${y}`, [x, y, c]);
  const s = Math.sin(t * TAU * 1.4);
  const H = b.thigh + b.shin;
  const top = -(H + b.torso);
  for (let y = top; y <= -H - 1; y++) for (let x = -2; x <= 1; x++) put(x, y, x < 0 ? pal.shirt : pal.shirtD);
  for (let y = top - 4; y <= top - 1; y++) for (let x = -2; x <= 1; x++) put(x, y, pal.hair);
  put(-3, top - 2, pal.skin);
  put(2, top - 2, pal.skin);
  const armL = 4 + Math.round(2 * s);
  const armR = 4 - Math.round(2 * s);
  for (let i = 0; i < armL; i++) put(-3, top + 1 - i, pal.shirt);
  put(-3, top + 1 - armL, pal.skin);
  for (let i = 0; i < armR; i++) put(2, top + 1 - i, pal.shirtD);
  put(2, top + 1 - armR, pal.skin);
  const liftL = Math.round(2 * Math.max(0, s));
  const liftR = Math.round(2 * Math.max(0, -s));
  for (let y = -H; y <= -liftR; y++) put(-2, y, pal.legs);
  for (let y = -H; y <= -liftL; y++) put(1, y, pal.legsD);
  put(-2, -liftR, pal.shoe);
  put(1, -liftL, pal.shoe);
  put(-1, -H, pal.legs);
  put(0, -H, pal.legsD);
  return { px: [...map.values()], head: [0, top - 2], hand: [-3, top + 1 - armL], top: top - 4 };
}

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
 * The car, origin at the middle of its wheelbase on the road. With a driver,
 * his head shows through the side window. `t` turns the wheels while moving.
 */
export function car(dir: 1 | -1, t: number, moving: boolean, driver: Palette | null): Pixel[] {
  const out: Pixel[] = [];
  const put = (x: number, y: number, c: string) => out.push([x * dir, y, c]);
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

/** 3×5 pixel glyphs for the few words he says. */
export const GLYPHS: Record<string, string[]> = {
  h: ['#..', '#..', '##.', '#.#', '#.#'],
  i: ['#', '.', '#', '#', '#'],
  '!': ['#', '#', '#', '.', '#'],
  z: ['###', '..#', '.#.', '#..', '###'],
};
