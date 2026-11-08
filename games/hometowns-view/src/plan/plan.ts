// Plan, then Build (spec §9.3). The mayor lays down free, undoable ghosts —
// roads dragged as straight or L-shaped lines, zones painted as rectangles,
// buildings dropped with a tap — and nothing is real until "Build it!" sends
// the whole plan as one atomic `build` move of at most 60 operations.
//
// Everything here is pure and DOM-free. The preview runs each ghost through
// the engine's own `applyBuild` on a throwaway copy of the town, one
// operation at a time, so the cost shown and every refusal sentence are
// exactly what the server will say, and the ghosts can be coloured green or
// red one by one.

import {
  BUILDINGS,
  CAT_ZONE,
  EngineError,
  MAP,
  buildingIndex,
  footprint,
  inMap,
  parcelOf,
  applyBuild,
  pathTiles,
  planesOf,
  roadAccess,
  roadDef,
  tileIndex,
  useCat,
  type DrawnRoad,
  type OpsEnv,
  type Op,
  type Params,
  type Rect,
  type TownState,
  type ZoneKind,
} from '../engine';

export type ToolKind = 'none' | 'road' | 'upgrade' | 'zone' | 'dezone' | 'place' | 'bulldoze' | 'eraser' | 'parcel';

/** The current build tool (bridge `tool({kind, id, variant})`). */
export interface Tool {
  kind: ToolKind;
  /** A catalogue building id for `place`. */
  id?: string;
  /** The road kind for `road`/`upgrade`, the zone for `zone`. */
  variant?: string;
  /** Rotation for `place`. */
  rot?: 0 | 1;
}

export const NO_TOOL: Tool = { kind: 'none' };

/** Tools that drag a line, a rectangle, or act on a tap. */
export function gestureOf(tool: Tool): 'line' | 'rect' | 'tap' | 'none' {
  switch (tool.kind) {
    case 'road':
    case 'upgrade':
      return 'line';
    case 'zone':
    case 'dezone':
    case 'bulldoze':
      return 'rect';
    case 'place':
    case 'parcel':
    case 'eraser':
      return 'tap';
    default:
      return 'none';
  }
}

/**
 * A dragged road: straight when the ends share a row or column, otherwise an
 * L that runs along the longer side first. Points are [x0, y0, x1, y1, …]
 * as the engine's `road` op takes them.
 */
export function snapRoad(ax: number, ay: number, bx: number, by: number): number[] {
  if (ax === bx && ay === by) return [ax, ay];
  if (ax === bx || ay === by) return [ax, ay, bx, by];
  return Math.abs(bx - ax) >= Math.abs(by - ay) ? [ax, ay, bx, ay, bx, by] : [ax, ay, ax, by, bx, by];
}

/** The rectangle two dragged corners span (inclusive), clipped to the map. */
export function rectOf(ax: number, ay: number, bx: number, by: number): Rect {
  const x0 = Math.max(0, Math.min(ax, bx));
  const y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.min(MAP - 1, Math.max(ax, bx));
  const y1 = Math.min(MAP - 1, Math.max(ay, by));
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** The op a finished gesture makes with `tool`, from tile a to tile b (a tap has a = b). Null: nothing to add. */
export function opFor(tool: Tool, ax: number, ay: number, bx: number, by: number): Op | null {
  switch (tool.kind) {
    case 'road':
      return { op: 'road', kind: (tool.variant ?? 'lane') as DrawnRoad, path: snapRoad(ax, ay, bx, by) };
    case 'upgrade':
      return { op: 'upgrade', kind: (tool.variant ?? 'street') as DrawnRoad, path: snapRoad(ax, ay, bx, by) };
    case 'zone':
      return { op: 'zone', zone: (tool.variant ?? 'homes') as ZoneKind, rect: rectOf(ax, ay, bx, by) };
    case 'dezone':
      return { op: 'dezone', rect: rectOf(ax, ay, bx, by) };
    case 'bulldoze':
      return { op: 'bulldoze', rect: rectOf(ax, ay, bx, by) };
    case 'place': {
      const kind = buildingIndex(tool.id ?? '');
      if (kind < 0) return null;
      const def = BUILDINGS[kind];
      const rot = tool.rot ?? 0;
      const [w, h] = footprint(def.w, def.h, rot);
      // The footprint is centred on the finger, then kept on the map.
      const x = Math.max(0, Math.min(MAP - w, bx - ((w - 1) >> 1)));
      const y = Math.max(0, Math.min(MAP - h, by - ((h - 1) >> 1)));
      return { op: 'place', id: def.id, x, y, rot };
    }
    case 'parcel':
      return { op: 'parcel', p: parcelOf(bx, by) };
    default:
      return null;
  }
}

/** The tiles one op covers (for drawing its ghost and for the eraser). */
export function opTiles(op: Op): number[] {
  switch (op.op) {
    case 'road':
    case 'upgrade':
      try {
        return pathTiles(op.path);
      } catch {
        return [];
      }
    case 'zone':
    case 'dezone':
    case 'bulldoze': {
      const [x0, y0, w, h] = op.rect;
      const out: number[] = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inMap(x, y)) out.push(tileIndex(x, y));
      return out;
    }
    case 'place': {
      const def = BUILDINGS[buildingIndex(op.id)];
      if (!def) return [];
      const [w, h] = footprint(def.w, def.h, op.rot);
      const out: number[] = [];
      for (let y = op.y; y < op.y + h; y++) for (let x = op.x; x < op.x + w; x++) if (inMap(x, y)) out.push(tileIndex(x, y));
      return out;
    }
    case 'parcel': {
      const out: number[] = [];
      const px = (op.p % 4) * 16;
      const py = Math.floor(op.p / 4) * 16;
      for (let y = py; y < py + 16; y++) for (let x = px; x < px + 16; x++) out.push(tileIndex(x, y));
      return out;
    }
  }
}

// ---- The ghost list ---------------------------------------------------------------------------------

/**
 * The ghosts on the map, with their own undo (the eraser and "undo" act on
 * ghosts; committed plans are undone through the engine's `undo` move).
 */
export class Plan {
  ops: Op[] = [];
  private past: Op[][] = [];
  private serial = 0;
  planId: string;

  constructor(
    private readonly maxOps = 60,
    private readonly idPrefix = 'plan',
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.planId = this.newId();
  }

  private newId(): string {
    this.serial += 1;
    return `${this.idPrefix}-${this.clock().toString(36)}-${this.serial}`;
  }

  get empty(): boolean {
    return this.ops.length === 0;
  }

  get full(): boolean {
    return this.ops.length >= this.maxOps;
  }

  /** Adds a ghost. False (and nothing changes) when the plan already holds the most a move may. */
  add(op: Op): boolean {
    if (this.full) return false;
    this.past.push(this.ops);
    this.ops = [...this.ops, op];
    return true;
  }

  /** The eraser: removes every ghost covering `tile`. Returns how many went. */
  erase(tile: number): number {
    const keep = this.ops.filter((op) => !opTiles(op).includes(tile));
    const gone = this.ops.length - keep.length;
    if (gone) {
      this.past.push(this.ops);
      this.ops = keep;
    }
    return gone;
  }

  /** Takes back the last ghost edit. */
  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.ops = prev;
    return true;
  }

  /** Drops every ghost; the id stays, so an undo brings the same plan back. */
  clear(): void {
    if (this.ops.length) this.past.push(this.ops);
    this.ops = [];
  }

  /** Replaces the ghosts with a suggested plan (advisor and wants deep links, §10.9 `ghost`). */
  replace(ops: Op[]): void {
    this.past.push(this.ops);
    this.ops = ops.slice(0, this.maxOps);
  }

  /** After a commit: the next plan starts empty, under a new id, with no ghost history. */
  committed(): void {
    this.ops = [];
    this.past = [];
    this.planId = this.newId();
  }

  /**
   * A committed plan the server refused comes back as ghosts, under its own
   * id, so it can be fixed and built again. Only onto an empty plan: if the
   * mayor has started another meanwhile, that one stays. True if restored.
   */
  restore(planId: string, ops: readonly Op[]): boolean {
    if (!this.empty) return false;
    this.ops = ops.slice(0, this.maxOps);
    this.past = [];
    this.planId = planId;
    return true;
  }
}

// ---- The preview ----------------------------------------------------------------------------------

export type GhostMark = 'ok' | 'bad' | 'noRoad' | 'demolish';

export interface OpPreview {
  op: Op;
  ok: boolean;
  cost: number;
  error: string | null;
}

export interface PlanPreview {
  ops: OpPreview[];
  /** £ the whole plan costs now (refunds netted), as the server will charge it. */
  cost: number;
  /** Monthly upkeep the plan adds, £ (catalogue figures at Normal funding). */
  upkeep: number;
  /** The first refusal: the plan cannot be built while this is set. */
  refused: string | null;
  /** Per tile: how its ghost is drawn. */
  marks: Map<number, GhostMark>;
  /** Coverage rings of placed buildings: centre in tiles, radius in tiles. */
  rings: { x: number; y: number; r: number }[];
}

export interface PreviewEnv {
  params: Params;
  dayIndex: number;
  profile: 'kid' | 'adult';
}

/** A deep copy (the town must have its planes written back: commitTown, which every engine move does). */
const clone = (t: TownState): TownState => JSON.parse(JSON.stringify(t)) as TownState;

/** The catalogue's monthly upkeep one op adds at Normal funding (roads per tile, buildings each). */
function upkeepOf(op: Op): number {
  if (op.op === 'place') return BUILDINGS[buildingIndex(op.id)]?.upkeep ?? 0;
  if (op.op === 'road') return roadDef(op.kind).upkeep * opTiles(op).length;
  return 0;
}

/**
 * Runs the ghosts through the engine one by one on a copy of `t`: each op's
 * cost or refusal, the plan's total, and how to draw every ghost tile.
 */
export function previewPlan(t: TownState, ops: readonly Op[], env: PreviewEnv): PlanPreview {
  const work = clone(t);
  const opsEnv: OpsEnv = { params: env.params, dayIndex: env.dayIndex, profile: env.profile };
  const out: OpPreview[] = [];
  let cost = 0;
  let upkeep = 0;
  let refused: string | null = null;
  ops.forEach((op, k) => {
    try {
      const r = applyBuild(work, `preview-${k}`, [op], opsEnv);
      out.push({ op, ok: true, cost: r.cost, error: null });
      cost += r.cost;
      upkeep += upkeepOf(op);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      out.push({ op, ok: false, cost: 0, error: e.message });
      refused ??= e.message;
    }
  });
  if (ops.length > env.params.build.maxOps) refused ??= `A plan can hold at most ${env.params.build.maxOps} steps.`;
  // The whole plan together: the server applies it atomically, so a plan that only fails as a whole
  // (it costs more than the treasury once every op is added up) is refused here too.
  if (!refused && ops.length) {
    try {
      cost = applyBuild(clone(t), 'preview-all', [...ops], opsEnv).cost;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      refused = e.message;
    }
  }

  const marks = new Map<number, GhostMark>();
  const rings: PlanPreview['rings'] = [];
  const access = roadAccess(work);
  const use = planesOf(work).use;
  for (const p of out) {
    const tiles = opTiles(p.op);
    if (p.op.op === 'bulldoze' || p.op.op === 'dezone') {
      for (const i of tiles) marks.set(i, 'demolish');
      continue;
    }
    if (p.op.op === 'zone') {
      // Tiles that took the zone are green with a road within 2, else "no road" red; skipped tiles are red.
      for (const i of tiles) marks.set(i, useCat(use[i]) === CAT_ZONE && p.ok ? (access[i] ? 'ok' : 'noRoad') : 'bad');
      continue;
    }
    for (const i of tiles) if (marks.get(i) !== 'bad') marks.set(i, p.ok ? 'ok' : 'bad');
    if (p.op.op === 'place') {
      const def = BUILDINGS[buildingIndex(p.op.id)];
      if (def && def.radius > 0 && Number.isFinite(def.radius)) {
        const [w, h] = footprint(def.w, def.h, p.op.rot);
        rings.push({ x: p.op.x + w / 2, y: p.op.y + h / 2, r: def.radius });
      }
    }
  }
  return { ops: out, cost, upkeep, refused, marks, rings };
}
