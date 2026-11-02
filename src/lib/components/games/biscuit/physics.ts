// Biscuit Tower's physics, on the TV (Rapier 2D, as Marbler). Browser only:
// the WASM loads on first use, from its own chunk, so no other page pays it.
//
// The TV is the authority on how a drop lands (`$lib/games/biscuit-tower`):
// it rebuilds the tower from the round's drops when it opens (fast-forwarded,
// unseen), simulates each new drop live, and says when it has settled — every
// body still for a moment — or toppled — anything off the plinth. Units are
// metres; one "biscuit" of height is `UNIT`.

import type { Item } from '$lib/games/biscuit-tower';

type Rapier = typeof import('@dimforge/rapier2d-compat');
type World = InstanceType<Rapier['World']>;
type Body = InstanceType<Rapier['RigidBody']>;

/** Half the plinth's width; anything that falls below it has toppled. */
export const PLINTH_HALF = 1.6;
/** How far either side of centre the crane swings. */
export const SWING = 1.9;
/** A tower's height is told in these: about a custard cream stood on its side. */
export const UNIT = 0.3;
/** Above the tower's top, where the crane lets go. */
const DROP_ABOVE = 2.2;
const STEP = 1 / 60;
/** Every body slower than this for `STILL_STEPS` and the drop has settled. */
const STILL = 0.04;
const STILL_STEPS = 40;
/** A drop is called after this long however it is behaving. */
const MAX_STEPS = 60 * 7;
const FELL_BELOW = -0.6;

/** Each item's shape (half extents, metres), weight and paint. */
export const SHAPES: Record<Item, { hw: number; hh: number; density: number; fill: string; edge: string; kind: 'bar' | 'round' | 'mug' | 'pot' }> = {
  custard: { hw: 0.5, hh: 0.14, density: 1, fill: '#e9c27a', edge: '#b88a3e', kind: 'bar' },
  bourbon: { hw: 0.55, hh: 0.15, density: 1, fill: '#5a3420', edge: '#2f1a0e', kind: 'bar' },
  digestive: { hw: 0.46, hh: 0.11, density: 1, fill: '#c99a5b', edge: '#93683a', kind: 'round' },
  scone: { hw: 0.36, hh: 0.26, density: 1.2, fill: '#d9a35f', edge: '#a06d32', kind: 'round' },
  brick: { hw: 0.5, hh: 0.22, density: 2.6, fill: '#a5462e', edge: '#6e2a19', kind: 'bar' },
  toast: { hw: 0.46, hh: 0.08, density: 0.7, fill: '#d8a254', edge: '#9b6526', kind: 'bar' },
  mug: { hw: 0.3, hh: 0.36, density: 1.4, fill: '#ece3d6', edge: '#8b7d6a', kind: 'mug' },
  teapot: { hw: 0.42, hh: 0.36, density: 1.6, fill: '#3fa3b0', edge: '#1f5f68', kind: 'pot' },
  kettle: { hw: 0.4, hh: 0.4, density: 1.5, fill: '#c9ccd0', edge: '#6b7076', kind: 'pot' },
};

let rapier: Promise<Rapier> | null = null;
async function loadRapier(): Promise<Rapier> {
  rapier ??= import('@dimforge/rapier2d-compat').then(async (R) => {
    await R.init();
    return R;
  });
  return rapier;
}

export interface Piece {
  item: Item;
  body: Body;
}

export type Outcome = { outcome: 'settled' | 'toppled'; height: number };

/** One round's tower. `drop` adds an item; `step` advances the live one. */
export class Tower {
  private constructor(
    private readonly R: Rapier,
    private readonly world: World,
    readonly pieces: Piece[],
  ) {}

  static async create(): Promise<Tower> {
    const R = await loadRapier();
    const world = new R.World({ x: 0, y: -9.81 });
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.2));
    world.createCollider(R.ColliderDesc.cuboid(PLINTH_HALF, 0.2).setFriction(0.9), ground);
    return new Tower(R, world, []);
  }

  /** The top of the tower (metres), 0 for an empty plinth. */
  top(): number {
    let top = 0;
    for (const p of this.pieces) {
      const y = p.body.translation().y;
      if (y > FELL_BELOW) top = Math.max(top, y + SHAPES[p.item].hh * 1.2);
    }
    return top;
  }

  /** Where the crane lets go: above the tower, at `x` (crane position -1..1). */
  dropPoint(x: number): { x: number; y: number } {
    return { x: x * SWING, y: this.top() + DROP_ABOVE };
  }

  /** Let go of an item at crane position `x`. */
  drop(item: Item, x: number): Piece {
    const { R } = this;
    const at = this.dropPoint(x);
    const s = SHAPES[item];
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.x, at.y).setLinearDamping(0.05).setAngularDamping(0.3));
    const collider = s.kind === 'round' ? R.ColliderDesc.roundCuboid(s.hw - 0.05, s.hh - 0.05, 0.05) : R.ColliderDesc.cuboid(s.hw, s.hh);
    this.world.createCollider(collider.setDensity(s.density).setFriction(0.85).setRestitution(0.02), body);
    const piece = { item, body };
    this.pieces.push(piece);
    return piece;
  }

  step(): void {
    this.world.timestep = STEP;
    this.world.step();
  }

  /** Something has fallen off the plinth. */
  toppled(): boolean {
    return this.pieces.some((p) => p.body.translation().y < FELL_BELOW || Math.abs(p.body.translation().x) > PLINTH_HALF + 1.2);
  }

  still(): boolean {
    return this.pieces.every((p) => {
      const v = p.body.linvel();
      return Math.hypot(v.x, v.y) < STILL && Math.abs(p.body.angvel()) < STILL;
    });
  }

  height(): number {
    return Math.round((this.top() / UNIT) * 10) / 10;
  }

  /**
   * Run a drop out without drawing it (rebuilding a tower after a reload, or
   * a TV catching up): returns how it landed.
   */
  settleNow(): Outcome {
    let still = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      this.step();
      if (this.toppled()) return { outcome: 'toppled', height: this.height() };
      still = this.still() ? still + 1 : 0;
      if (still >= STILL_STEPS) break;
    }
    return { outcome: 'settled', height: this.height() };
  }

  free(): void {
    this.world.free();
  }
}

/** Follows one live drop step by step: `tick` once a frame, an outcome when it is decided. */
export class LiveDrop {
  private still = 0;
  private steps = 0;
  constructor(private readonly tower: Tower) {}

  tick(steps = 1): Outcome | null {
    for (let i = 0; i < steps; i++) {
      this.tower.step();
      this.steps++;
      if (this.tower.toppled()) return { outcome: 'toppled', height: this.tower.height() };
      this.still = this.tower.still() ? this.still + 1 : 0;
      if (this.still >= STILL_STEPS || this.steps >= MAX_STEPS) return { outcome: 'settled', height: this.tower.height() };
    }
    return null;
  }
}
