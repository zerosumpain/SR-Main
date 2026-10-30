// The Pixi v8 painter (spec §9.15). It draws a MapModel either as soft 2:1
// isometric "toy-town" blocks or as the flat top-down planning view (§9.3),
// plus the plan's ghosts, coverage rings, the time-lapse sparkles and a little
// decoration. All the deciding (colours, lens steps, what a tile is) happens
// in model.ts and the controller; this file only turns it into Graphics and
// turns fingers into tiles.
//
// Budget rules (§9.15): terrain, roads and blocks are painted per 16×16
// chunk and a chunk is repainted only when its signature changes; the page
// renders on demand (nothing moves, nothing draws), decoration is capped and
// stops when the app says the phone is hot, and nothing runs while the page
// is in the background.
//
// Gestures: one finger pans, or draws while a tool is active (then two
// fingers pan); pinch zooms; a long press inspects; a double tap fits the
// town; a magnifier loupe follows a drawing finger on touch screens. A mouse
// pans with the middle or right button and zooms with the wheel.

import { Application, Container, Graphics, Matrix, RenderTexture, Sprite, Ticker } from 'pixi.js';
import { CAT_ZONE, MAP, Z_INDUSTRY, parcelOf, planesOf, useCat, usePayload, type TownState } from '../engine';
import type { GhostMark, PlanPreview } from '../plan/plan';
import { E, N, S, W, building, buildingHeight, car, carColour, chimneyTop, prism, rail, rnd, road, shadow, terrainDetail, terrainSolids, zoneHeight, zoned, type Pen } from './art';
import { RAIL_TILE, type MapModel } from './model';
import { shade } from './palette';

export type Projection = 'iso' | 'top';

/** Top-down tile size in world units. */
export const TILE = 12;
/** Isometric half-width and half-height of a tile diamond (2:1). */
export const HW = 12;
export const HH = 6;

const CHUNK = 16;
const CHUNKS = MAP / CHUNK;
/** While the town changes every tick, repaint at most this often (ms); other changes paint at once. */
const REPAINT_MS = 200;
/** A finger that moves less than this (CSS px) is a tap or a press. */
const SLOP = 8;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 320;
/** "1×" zoom: a tile 32 CSS px wide; pinch runs 0.5–3× of it (and out far enough to fit the town). */
const ONE_X_TILE_PX = 32;
/** Decoration cap (§9.15: at most 300 animated decorations). */
const MAX_PUFFS = 120;
/** Cars on the roads at most (decoration, so inside §9.15's 300 with the smoke). */
const MAX_CARS = 90;
/** Tiles a car drives in a second. */
const CAR_SPEED = 1.1;
/** Below this zoom (camera scale over 1×) the fine detail is left out: it would be a pixel. */
const FAR_DETAIL = 0.55;
const LOUPE_PX = 120;

const GHOST_COLOUR: Record<GhostMark, [number, number]> = {
  ok: [0x3a8658, 0.5],
  bad: [0xb54a3a, 0.55],
  noRoad: [0xd9822b, 0.55],
  demolish: [0x6b2d3a, 0.4],
};

export interface MapHandlers {
  /** The tile under a mouse (null when it leaves). */
  hover?(tile: [number, number] | null): void;
  /** A tap, a long press (inspect) or a double tap (already handled: the map fits). */
  tap?(tile: [number, number], kind: 'tap' | 'long'): void;
  /** A drawing gesture with the active tool, from its first tile to the current one. */
  stroke?(from: [number, number], to: [number, number], phase: 'move' | 'end' | 'cancel'): void;
  /** The camera moved (DOM overlays reposition). */
  camera?(): void;
  /** The map's host changed size (the loop should draw a frame). */
  resized?(): void;
}

export interface MapView {
  readonly app: Application;
  /** Repaints if `key` changed since the last call (throttled while the town ticks). Returns whether it painted. */
  update(t: TownState, model: () => MapModel, key: string, urgent?: boolean): boolean;
  setGhosts(p: PlanPreview | null): void;
  /** What one-finger drags do: draw with a tool, or pan. */
  setGesture(g: 'line' | 'rect' | 'tap' | 'none'): void;
  setProjection(p: Projection): void;
  readonly projection: Projection;
  /** Sparkles where the time-lapse just revealed something (tile indices). */
  sparkle(tiles: number[]): void;
  /** Decoration on or off (thermal, Low Power, Reduce Motion). */
  setDecor(on: boolean): void;
  fit(t?: TownState): void;
  focus(x: number, y: number): void;
  /** The camera as it is (scale and offset), to put back later with `setView`. */
  view(): { s: number; x: number; y: number };
  setView(v: { s: number; x: number; y: number }): void;
  tileAt(clientX: number, clientY: number): [number, number] | null;
  /** A tile centre in CSS px relative to the map's host (DOM overlays). */
  tileToScreen(x: number, y: number): [number, number];
  /** Forgets what was painted, so the next update repaints every chunk. */
  invalidate(): void;
  /** Draws a frame if anything changed or something animates. Returns whether it drew. */
  render(now: number): boolean;
  /** When (performance.now) a repaint `update` held back for its throttle is due, or null: the loop must wake for it. */
  readonly deferredAt: number | null;
  /** True while something animates (decoration, sparkles), so the loop keeps going. */
  readonly animating: boolean;
  resize(): void;
  destroy(): void;
}

/** A cheap per-chunk signature of everything the chunk draws (tiles plus the buildings drawn in it). */
export function chunkSignatures(m: MapModel): number[] {
  const sig = new Array<number>(CHUNKS * CHUNKS).fill(0x811c9dc5);
  const mixIn = (k: number, v: number) => {
    sig[k] = Math.imul(sig[k] ^ (v >>> 0), 16777619) >>> 0;
  };
  for (let i = 0; i < m.ground.length; i++) {
    const x = i % MAP;
    const y = (i - x) / MAP;
    const k = Math.floor(y / CHUNK) * CHUNKS + Math.floor(x / CHUNK);
    mixIn(k, m.ground[i]);
    mixIn(k, m.block[i] ^ (m.level[i] << 24) ^ (m.tier[i] << 28) ^ (m.scaffold[i] << 30));
    // A road's markings follow its neighbours, which may be in the next chunk.
    if (m.road[i]) mixIn(k, links(m, x, y) | (junctionsNext(m, x, y) << 4) | (m.road[i] << 8));
    else if (m.zone[i] || m.built[i]) mixIn(k, m.zone[i] | (m.built[i] << 4));
  }
  for (const b of m.buildings) {
    const k = chunkOfFront(b.x, b.y, b.w, b.h);
    mixIn(k, b.index ^ (b.x << 8) ^ (b.y << 16) ^ (b.w << 24) ^ (b.h << 28));
    mixIn(k, b.colour ^ (b.building << 24) ^ (b.damaged ? 1 << 31 : 0));
  }
  return sig;
}

/** Which neighbours of a road (or railway) tile it joins: E, S, W, N bits. */
export function links(m: MapModel, x: number, y: number): number {
  const r = m.road[y * MAP + x];
  if (!r) return 0;
  const rail = r === RAIL_TILE;
  const joins = (nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) return false;
    const o = m.road[ny * MAP + nx];
    return o !== 0 && (o === RAIL_TILE) === rail;
  };
  return (joins(x + 1, y) ? E : 0) | (joins(x, y + 1) ? S : 0) | (joins(x - 1, y) ? W : 0) | (joins(x, y - 1) ? N : 0);
}

function bits(v: number): number {
  return (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
}

/** Which of a road tile's joined sides lead into a junction (a road tile joining three or four ways). */
export function junctionsNext(m: MapModel, x: number, y: number): number {
  const l = links(m, x, y);
  if (bits(l) >= 3 || m.road[y * MAP + x] === RAIL_TILE) return 0;
  let out = 0;
  if (l & E && bits(links(m, x + 1, y)) >= 3) out |= E;
  if (l & W && bits(links(m, x - 1, y)) >= 3) out |= W;
  if (l & S && bits(links(m, x, y + 1)) >= 3) out |= S;
  if (l & N && bits(links(m, x, y - 1)) >= 3) out |= N;
  return out;
}

/** A building is drawn with the chunk of its front corner, so the painter's order holds in isometric. */
function chunkOfFront(x: number, y: number, w: number, h: number): number {
  const fx = Math.min(MAP - 1, x + w - 1);
  const fy = Math.min(MAP - 1, y + h - 1);
  return Math.floor(fy / CHUNK) * CHUNKS + Math.floor(fx / CHUNK);
}

// ---- Projection ----------------------------------------------------------------------------------

/** A grid point (tile corner) in world units. */
export function project(p: Projection, gx: number, gy: number): [number, number] {
  return p === 'iso' ? [(gx - gy) * HW, (gx + gy) * HH] : [gx * TILE, gy * TILE];
}

/** A world point back to a fractional grid point (ground level). */
export function unproject(p: Projection, wx: number, wy: number): [number, number] {
  if (p === 'top') return [wx / TILE, wy / TILE];
  const u = wx / HW;
  const v = wy / HH;
  return [(u + v) / 2, (v - u) / 2];
}

/** The world-space bounds of the tile rectangle [x0, x1) × [y0, y1). */
function boundsOf(p: Projection, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const pts = [project(p, x0, y0), project(p, x1, y0), project(p, x1, y1), project(p, x0, y1)];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys) - (p === 'iso' ? 40 : 0), Math.max(...xs), Math.max(...ys)];
}

/** The bounding box of the town's open parcels, in tiles. */
function townBox(t: TownState | undefined): [number, number, number, number] {
  if (!t) return [0, 0, MAP, MAP];
  let x0 = MAP;
  let y0 = MAP;
  let x1 = 0;
  let y1 = 0;
  for (let p = 0; p < 16; p++) {
    if (!((t.parcels >> p) & 1)) continue;
    const px = (p % 4) * 16;
    const py = Math.floor(p / 4) * 16;
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px + 16);
    y1 = Math.max(y1, py + 16);
  }
  return x1 > x0 ? [x0, y0, x1, y1] : [0, 0, MAP, MAP];
}

// ---- The view ------------------------------------------------------------------------------------

export async function createMapView(host: HTMLElement, h: MapHandlers = {}): Promise<MapView> {
  const app = new Application();
  await app.init({
    background: 0xf3eee3,
    resizeTo: host,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    // Render on demand (§9.15): the page draws a frame only when something changed.
    autoStart: false,
    preference: 'webgl',
    // The page reads the canvas's pointer events itself (below): Pixi's own
    // hit-testing and its hover ticker would only cost frames.
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
  });
  app.ticker.stop();
  // Pixi's shared and system tickers each run their own animation-frame loop
  // once anything is added to them (the event system adds its hover check to
  // the system one); nothing here runs on them, so neither may keep the
  // phone awake.
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  Ticker.system.autoStart = false;
  Ticker.system.stop();
  host.appendChild(app.canvas);
  const canvas = app.canvas;
  canvas.style.touchAction = 'none';
  // Pixi follows window resizes only; the host also changes size when a sheet opens beside it.
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    app.resize();
    dirty = true;
    h.camera?.();
    h.resized?.();
  }) : null;
  observer?.observe(host);

  let projection: Projection = 'iso';
  let dirty = true;
  let gesture: 'line' | 'rect' | 'tap' | 'none' = 'none';
  let decorOn = true;

  // stage → camera (pan and zoom) → world (identity) → layers.
  const camera = new Container();
  const world = new Container();
  const groundLayer = new Container();
  const shadowLayer = new Container();
  const structureLayer = new Container();
  const grounds: Graphics[] = [];
  const shadows: Graphics[] = [];
  const structures: Graphics[] = [];
  for (let k = 0; k < CHUNKS * CHUNKS; k++) {
    grounds.push(groundLayer.addChild(new Graphics()));
    shadows.push(shadowLayer.addChild(new Graphics()));
    structures.push(new Graphics());
  }
  // Isometric painter's order: chunks back to front by cx + cy.
  const order = [...Array(CHUNKS * CHUNKS).keys()].sort((a, b) => (a % CHUNKS) + Math.floor(a / CHUNKS) - ((b % CHUNKS) + Math.floor(b / CHUNKS)) || a - b);
  for (const k of order) structureLayer.addChild(structures[k]);
  const ghostLayer = new Graphics();
  const overlay = new Graphics();
  const decor = new Graphics();
  // Cars drive under the solids: a block in front of a road hides the car behind it.
  const traffic = new Graphics();
  world.addChild(groundLayer, shadowLayer, ghostLayer, traffic, structureLayer, decor, overlay);
  // A render group keeps the world's draw instructions on the GPU side: panning and zooming the camera
  // then only changes one transform, instead of re-batching four thousand tiles every frame.
  world.isRenderGroup = true;
  camera.addChild(world);
  app.stage.addChild(camera);

  // The loupe: the world under the finger, drawn twice as large into a small texture above it.
  const loupeTex = RenderTexture.create({ width: LOUPE_PX, height: LOUPE_PX, resolution: Math.min(2, globalThis.devicePixelRatio || 1) });
  const loupe = new Sprite(loupeTex);
  const loupeMask = new Graphics().circle(LOUPE_PX / 2, LOUPE_PX / 2, LOUPE_PX / 2).fill(0xffffff);
  const loupeRim = new Graphics().circle(LOUPE_PX / 2, LOUPE_PX / 2, LOUPE_PX / 2 - 1).stroke({ width: 2, color: 0x2b2620, alpha: 0.8 });
  const loupeBox = new Container();
  loupeBox.addChild(loupe, loupeMask, loupeRim);
  loupe.mask = loupeMask;
  loupeBox.visible = false;
  app.stage.addChild(loupeBox);

  let lastKey = '';
  let lastPaint = -Infinity;
  /** A throttled repaint `update` held back, due at this instant (performance.now), or null. */
  let deferred: number | null = null;
  let lastSig: number[] = [];
  let lastModel: MapModel | null = null;
  let lastTown: TownState | null = null;
  let ghosts: PlanPreview | null = null;
  let sparkles: { i: number; at: number }[] = [];
  let puffs: { x: number; y: number; z: number; phase: number }[] = [];
  /** Cars: on tile (x, y), heading to the neighbour in direction `dir` (E/S/W/N), `t` of the way. */
  let cars: { x: number; y: number; dir: number; t: number; speed: number; colour: number }[] = [];
  /** Fine detail painted (the camera is close enough to see it). */
  let hi = true;
  let lastFrame = 0;
  /** Industry tiles of the town last painted (smoke comes from these). */
  let lastIndustry: Uint8Array | null = null;

  // ---- Painting ----

  const corner = (gx: number, gy: number) => project(projection, gx, gy);

  /** The four corners of tile (x, y), pulled in by `inset` tiles, as a flat point list. */
  function diamond(x: number, y: number, inset = 0): number[] {
    const a = corner(x + inset, y + inset);
    const b = corner(x + 1 - inset, y + inset);
    const c = corner(x + 1 - inset, y + 1 - inset);
    const d = corner(x + inset, y + 1 - inset);
    return [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
  }

  const pen = (g: Graphics): Pen => ({ g, top: projection === 'top', hi, lens: lensOn });
  let lensOn = false;

  function paintGround(g: Graphics, m: MapModel, cx: number, cy: number): void {
    g.clear();
    const p = pen(g);
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++)
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const i = ty * MAP + tx;
        const r = m.road[i];
        if (r && m.lens[i] === 255 && m.open[i]) {
          if (r === RAIL_TILE) rail(p, tx, ty, links(m, tx, ty));
          else road(p, tx, ty, r, links(m, tx, ty), junctionsNext(m, tx, ty));
          continue;
        }
        // A touch of per-tile variation, so a field of grass is not one flat colour.
        const base = m.zone[i] || r ? m.ground[i] : shade(m.ground[i], 0.97 + 0.06 * rnd(tx, ty, 90));
        if (projection === 'top') g.rect(tx * TILE, ty * TILE, TILE, TILE).fill(base);
        else g.poly(diamond(tx, ty)).fill(base);
        if (r || m.zone[i] || m.built[i]) {
          if (m.zone[i] && !m.level[i] && hi && projection === 'iso') {
            // An empty lot: a pale kerb round it.
            g.poly(diamond(tx, ty, 0.06)).stroke({ width: 0.5, color: shade(base, 1.08), alpha: 0.9 });
          }
        } else {
          let shore = 0;
          if (m.terrain[i] === 1) {
            const land = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < MAP && ny < MAP && m.terrain[ny * MAP + nx] !== 1;
            shore = (land(tx + 1, ty) ? E : 0) | (land(tx, ty + 1) ? S : 0) | (land(tx - 1, ty) ? W : 0) | (land(tx, ty - 1) ? N : 0);
          }
          terrainDetail(p, tx, ty, m.terrain[i], base, shore);
        }
        if (m.scaffold[i] && !m.level[i]) {
          // Scaffolding on an empty lot: a thin frame.
          g.poly(diamond(tx, ty, 0.2)).stroke({ width: 1, color: 0x8a6d3b, alpha: 0.9 });
        }
      }
    // Parcel edges: a faint line where locked land starts reads as "the edge of your town".
    if (lastTown) {
      const t = lastTown;
      const open = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP && y < MAP && ((t.parcels >> parcelOf(x, y)) & 1) === 1;
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      if (open(x0, y0)) {
        const edges: [number, number, number, number][] = [];
        if (!open(x0 - 1, y0)) edges.push([x0, y0, x0, y0 + CHUNK]);
        if (!open(x0 + CHUNK, y0)) edges.push([x0 + CHUNK, y0, x0 + CHUNK, y0 + CHUNK]);
        if (!open(x0, y0 - 1)) edges.push([x0, y0, x0 + CHUNK, y0]);
        if (!open(x0, y0 + CHUNK)) edges.push([x0, y0 + CHUNK, x0 + CHUNK, y0 + CHUNK]);
        for (const [a, b, c, d] of edges) {
          const p = corner(a, b);
          const q = corner(c, d);
          g.moveTo(p[0], p[1]).lineTo(q[0], q[1]).stroke({ width: 1.5, color: 0x6b6257, alpha: 0.55 });
        }
      }
    }
  }

  /** Scaffolding round a solid being built: poles at the corners and two rails. */
  function scaffolding(p: Pen, x0: number, y0: number, x1: number, y1: number, h: number): void {
    prism(p, x0, y0, x1, y1, 0, 0.6, 0xb8ab94);
    if (p.top) {
      const [ax, ay] = corner(x0, y0);
      const [bx, by] = corner(x1, y1);
      p.g.rect(ax, ay, bx - ax, by - ay).stroke({ width: 1, color: 0x8a6d3b, alpha: 0.9 });
      return;
    }
    const pole = (x: number, y: number) => {
      const [sx, sy] = corner(x, y);
      p.g.moveTo(sx, sy).lineTo(sx, sy - h).stroke({ width: 0.6, color: 0x8a6d3b, alpha: 0.95 });
    };
    pole(x0, y1);
    pole(x1, y1);
    pole(x1, y0);
    for (const z of [h * 0.5, h]) {
      const [ax, ay] = corner(x0, y1);
      const [bx, by] = corner(x1, y1);
      const [cx, cy] = corner(x1, y0);
      p.g.moveTo(ax, ay - z).lineTo(bx, by - z).lineTo(cx, cy - z).stroke({ width: 0.5, color: 0x8a6d3b, alpha: 0.9 });
    }
  }

  function paintStructures(g: Graphics, sg: Graphics, m: MapModel, k: number): void {
    g.clear();
    sg.clear();
    const p = pen(g);
    const sp = pen(sg);
    const cx = k % CHUNKS;
    const cy = Math.floor(k / CHUNKS);
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++)
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const i = ty * MAP + tx;
        const lv = m.level[i];
        if (!lv) {
          if (!m.road[i] && !m.zone[i] && !m.built[i] && m.lens[i] === 255 && (m.terrain[i] === 3 || m.terrain[i] === 5 || ((m.terrain[i] === 0 || m.terrain[i] === 4) && hi)))
            items.push({ depth: tx + ty, draw: () => terrainSolids(p, tx, ty, m.terrain[i], m.open[i] === 1) });
          continue;
        }
        const zone = m.zone[i] - 1;
        const height = zoneHeight(zone, lv);
        shadow(sp, tx + 0.12, ty + 0.12, tx + 0.88, ty + 0.88, height);
        items.push({
          depth: tx + ty,
          draw: () => {
            zoned(p, tx, ty, zone, lv, m.tier[i], m.block[i]);
            if (m.scaffold[i]) scaffolding(p, tx + 0.06, ty + 0.06, tx + 0.94, ty + 0.94, height + 2);
          },
        });
      }
    for (const b of m.buildings) {
      if (chunkOfFront(b.x, b.y, b.w, b.h) !== k) continue;
      const height = buildingHeight(b);
      if (b.building <= 0) shadow(sp, b.x + 0.1, b.y + 0.1, b.x + b.w - 0.1, b.y + b.h - 0.1, height);
      items.push({
        depth: b.x + b.w - 1 + b.y + b.h - 1,
        draw: () => {
          if (b.building > 0) {
            // Being built: footings and scaffolding to the height it will be.
            scaffolding(p, b.x + 0.1, b.y + 0.1, b.x + b.w - 0.1, b.y + b.h - 0.1, Math.min(height, 12));
            return;
          }
          building(p, b);
          if (b.damaged) {
            const [px, py] = corner(b.x + b.w / 2, b.y + b.h / 2);
            g.circle(px, py - height - 4, 3).fill({ color: 0x7a7a7a, alpha: 0.85 });
            g.circle(px + 2.5, py - height - 7, 2.2).fill({ color: 0x8a8a8a, alpha: 0.7 });
          }
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }

  /** Chunks whose paint is out of date but which were off screen at the time. */
  const stale = new Uint8Array(CHUNKS * CHUNKS);

  function paintChunk(m: MapModel, k: number): void {
    stale[k] = 0;
    paintGround(grounds[k], m, k % CHUNKS, Math.floor(k / CHUNKS));
    paintStructures(structures[k], shadows[k], m, k);
  }

  /** Whether chunk k (with its tallest towers) is on screen or close to it. */
  function chunkVisible(k: number): boolean {
    const cx = (k % CHUNKS) * CHUNK;
    const cy = Math.floor(k / CHUNKS) * CHUNK;
    const [x0, y0, x1, y1] = boundsOf(projection, cx, cy, cx + CHUNK, cy + CHUNK);
    const s = camera.scale.x;
    const lift = projection === 'iso' ? 40 : 0;
    const left = camera.position.x + x0 * s;
    const right = camera.position.x + x1 * s;
    const top = camera.position.y + (y0 - lift) * s;
    const bottom = camera.position.y + y1 * s;
    const mx = app.screen.width * 0.25;
    const my = app.screen.height * 0.25;
    return right >= -mx && left <= app.screen.width + mx && bottom >= -my && top <= app.screen.height + my;
  }

  /** Paints the out-of-date chunks that have come into view. Returns whether it painted any. */
  function paintStale(): boolean {
    if (!lastModel) return false;
    let any = false;
    for (let k = 0; k < stale.length; k++)
      if (stale[k] && chunkVisible(k)) {
        paintChunk(lastModel, k);
        any = true;
      }
    return any;
  }

  function paint(m: MapModel, force: boolean): void {
    lensOn = m.lensOn;
    lastModel = m;
    const sig = chunkSignatures(m);
    for (let k = 0; k < sig.length; k++) {
      if (!force && sig[k] === lastSig[k]) continue;
      // A chunk off screen is painted when it comes into view (paintStale): close up, most of the town is.
      if (chunkVisible(k)) paintChunk(m, k);
      else stale[k] = 1;
    }
    lastSig = sig;
    lastModel = m;
    seedPuffs(m);
    seedCars(m);
    dirty = true;
  }

  function paintGhosts(): void {
    ghostLayer.clear();
    overlay.clear();
    if (!ghosts) return;
    for (const [i, mark] of ghosts.marks) {
      const [c, a] = GHOST_COLOUR[mark];
      const x = i % MAP;
      const y = (i - x) / MAP;
      if (projection === 'top') ghostLayer.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: c, alpha: a });
      else ghostLayer.poly(diamond(x, y)).fill({ color: c, alpha: a });
    }
    for (const r of ghosts.rings) {
      const [px, py] = corner(r.x, r.y);
      if (projection === 'top') overlay.circle(px, py, r.r * TILE).stroke({ width: 1.5, color: 0x2f6f8f, alpha: 0.8 });
      else overlay.ellipse(px, py, r.r * Math.SQRT2 * HW, r.r * Math.SQRT2 * HH).stroke({ width: 1.5, color: 0x2f6f8f, alpha: 0.8 });
    }
    dirty = true;
  }

  // ---- Decoration (factory smoke) ----

  function seedPuffs(m: MapModel): void {
    puffs = [];
    if (!decorOn) return;
    for (let i = 0; i < m.level.length && puffs.length < MAX_PUFFS; i++) {
      // Industry blocks at level 1–4 smoke from their chimneys; level-5 makers' sheds are clean (§9.15).
      if (!(m.level[i] > 0 && m.level[i] < 5 && lastIndustry?.[i] === 1)) continue;
      const top = chimneyTop(3, m.level[i], i % MAP, Math.floor(i / MAP));
      if (top) puffs.push({ x: top[0], y: top[1], z: top[2], phase: (i * 37) % 100 });
    }
  }

  // ---- Decoration (traffic) ----

  const STEP: Record<number, [number, number]> = { [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0], [N]: [0, -1] };
  const BACK: Record<number, number> = { [E]: W, [W]: E, [S]: N, [N]: S };

  /** Cars on the town's roads: more roads and more people, more cars, up to the cap. */
  function seedCars(m: MapModel): void {
    if (!decorOn || m.lensOn) {
      cars = [];
      return;
    }
    const tiles: number[] = [];
    let built = 0;
    for (let i = 0; i < m.road.length; i++) {
      if (m.road[i] && m.road[i] !== RAIL_TILE && m.open[i] && links(m, i % MAP, Math.floor(i / MAP))) tiles.push(i);
      if (m.level[i]) built += m.level[i];
    }
    const want = Math.min(MAX_CARS, Math.floor(tiles.length / 5), Math.floor(built / 6));
    // Keep the cars already driving where their road still is.
    cars = cars.filter((car) => m.road[car.y * MAP + car.x] && m.road[car.y * MAP + car.x] !== RAIL_TILE).slice(0, want);
    for (let k = cars.length; k < want; k++) {
      const i = tiles[Math.floor(rnd(k, tiles.length, 97) * tiles.length)];
      const x = i % MAP;
      const y = Math.floor(i / MAP);
      cars.push({ x, y, dir: nextDir(m, x, y, 0, k), t: rnd(k, 3, 98), speed: CAR_SPEED * (0.75 + 0.5 * rnd(k, 5, 99)), colour: carColour(Math.floor(rnd(k, 7, 96) * 9)) });
    }
  }

  /** Where a car on (x, y) goes next: on along the road if it can, else any other way, else back. */
  function nextDir(m: MapModel, x: number, y: number, from: number, salt: number): number {
    const l = links(m, x, y);
    const options = [E, S, W, N].filter((d) => l & d && d !== (from ? BACK[from] : 0));
    if (!options.length) return from ? BACK[from] : E;
    if (from && options.includes(from) && rnd(x + salt, y, 95) < 0.6) return from;
    return options[Math.floor(rnd(x * 7 + salt, y * 3 + Math.floor(performance.now() / 997), 94) * options.length)];
  }

  function drawTraffic(dt: number): void {
    traffic.clear();
    if (!decorOn || !lastModel || !cars.length) return;
    const m = lastModel;
    const p = pen(traffic);
    for (let k = 0; k < cars.length; k++) {
      const v = cars[k];
      v.t += (v.speed * dt) / 1000;
      while (v.t >= 1) {
        const [dx, dy] = STEP[v.dir] ?? [0, 0];
        const nx = v.x + dx;
        const ny = v.y + dy;
        v.t -= 1;
        if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP || !m.road[ny * MAP + nx] || m.road[ny * MAP + nx] === RAIL_TILE) {
          v.dir = BACK[v.dir] ?? E;
          continue;
        }
        v.x = nx;
        v.y = ny;
        v.dir = nextDir(m, nx, ny, v.dir, k);
      }
      const [dx, dy] = STEP[v.dir] ?? [0, 0];
      // Drive on the left: offset to the left of the heading.
      const off = 0.17;
      const gx = v.x + 0.5 + dx * (v.t - 0.5) + dy * off;
      const gy = v.y + 0.5 + dy * (v.t - 0.5) - dx * off;
      car(p, gx, gy, dx !== 0 ? 'x' : 'y', v.colour);
    }
  }


  function drawDecor(now: number): void {
    decor.clear();
    if (!decorOn || !lastModel) return;
    for (const p of puffs) {
      const [px, py] = corner(p.x, p.y);
      const top = py - p.z - 1;
      const t = ((now / 40 + p.phase) % 100) / 100;
      decor.circle(px + t * 4, top - t * 14, 1.5 + t * 2.5).fill({ color: 0xbdb6ab, alpha: 0.55 * (1 - t) });
    }
  }

  function drawSparkles(now: number): void {
    if (!sparkles.length) return;
    sparkles = sparkles.filter((s) => now - s.at < 700);
    for (const s of sparkles) {
      const x = s.i % MAP;
      const y = (s.i - x) / MAP;
      const [px, py] = corner(x + 0.5, y + 0.5);
      const k = (now - s.at) / 700;
      overlay.circle(px, py - 6, 3 + k * 9).stroke({ width: 1.5, color: 0xf2c14e, alpha: 1 - k });
    }
  }

  // ---- Camera ----

  let fitScale = 1;
  const oneX = () => ONE_X_TILE_PX / (projection === 'iso' ? 2 * HW : TILE);
  const minScale = () => Math.min(fitScale, 0.5 * oneX());
  const maxScale = () => 3 * oneX();

  function setCamera(s: number, x: number, y: number): void {
    camera.scale.set(Math.max(minScale(), Math.min(maxScale(), s)));
    camera.position.set(x, y);
    dirty = true;
    detailFor();
    h.camera?.();
  }

  /** Paints the fine detail in when the camera comes close, and out when it pulls away (with some slack, so a pinch at the edge does not flicker). */
  function detailFor(): void {
    const z = camera.scale.x / oneX();
    const want = hi ? z >= FAR_DETAIL * 0.8 : z >= FAR_DETAIL;
    if (want === hi) return;
    hi = want;
    if (lastModel) paint(lastModel, true);
  }

  function fit(t: TownState | undefined = lastTown ?? undefined): void {
    const w = app.screen.width;
    const hgt = app.screen.height;
    const [x0, y0, x1, y1] = townBox(t);
    const [bx0, by0, bx1, by1] = boundsOf(projection, x0, y0, x1, y1);
    const s = Math.max(0.05, Math.min(w / (bx1 - bx0 + 24), hgt / (by1 - by0 + 24)));
    fitScale = s;
    camera.scale.set(s);
    camera.position.set((w - (bx0 + bx1) * s) / 2, (hgt - (by0 + by1) * s) / 2);
    dirty = true;
    detailFor();
    h.camera?.();
  }

  function focus(x: number, y: number): void {
    const [px, py] = corner(x + 0.5, y + 0.5);
    const s = Math.max(camera.scale.x, oneX());
    setCamera(s, app.screen.width / 2 - px * s, app.screen.height / 2 - py * s);
  }

  function zoomAt(px: number, py: number, factor: number): void {
    const s0 = camera.scale.x;
    const s1 = Math.max(minScale(), Math.min(maxScale(), s0 * factor));
    setCamera(s1, px - ((px - camera.position.x) * s1) / s0, py - ((py - camera.position.y) * s1) / s0);
  }

  function local(clientX: number, clientY: number): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }

  function tileAt(clientX: number, clientY: number): [number, number] | null {
    const [lx, ly] = local(clientX, clientY);
    const s = camera.scale.x;
    const [gx, gy] = unproject(projection, (lx - camera.position.x) / s, (ly - camera.position.y) / s);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    return x >= 0 && y >= 0 && x < MAP && y < MAP ? [x, y] : null;
  }

  function tileToScreen(x: number, y: number): [number, number] {
    const [px, py] = corner(x + 0.5, y + 0.5);
    return [camera.position.x + px * camera.scale.x, camera.position.y + py * camera.scale.x];
  }

  // ---- Gestures ----

  const pointers = new Map<number, { x: number; y: number; type: string }>();
  let mode: 'idle' | 'pending' | 'pan' | 'draw' | 'pinch' | 'pressed' = 'idle';
  let downPos: [number, number] = [0, 0];
  let downTile: [number, number] | null = null;
  let panFrom = { x: 0, y: 0, cx: 0, cy: 0 };
  let pinchFrom = { d: 1, mx: 0, my: 0, s: 1, cx: 0, cy: 0 };
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTap = { at: 0, x: 0, y: 0 };
  let drawPointer: { type: string; x: number; y: number } | null = null;

  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };

  function pinchState() {
    const [a, b] = [...pointers.values()];
    const [ax, ay] = local(a.x, a.y);
    const [bx, by] = local(b.x, b.y);
    return { d: Math.hypot(bx - ax, by - ay) || 1, mx: (ax + bx) / 2, my: (ay + by) / 2 };
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.size === 2) {
      clearPress();
      if (mode === 'draw' && downTile) h.stroke?.(downTile, downTile, 'cancel');
      mode = 'pinch';
      drawPointer = null;
      loupeBox.visible = false;
      const p = pinchState();
      pinchFrom = { ...p, s: camera.scale.x, cx: camera.position.x, cy: camera.position.y };
      return;
    }
    if (pointers.size > 2) return;
    downPos = [e.clientX, e.clientY];
    downTile = tileAt(e.clientX, e.clientY);
    panFrom = { x: e.clientX, y: e.clientY, cx: camera.position.x, cy: camera.position.y };
    const panButton = e.button === 1 || e.button === 2;
    mode = gesture !== 'none' && !panButton ? 'pending' : 'pan';
    clearPress();
    // With a drawing tool the finger draws: a child often presses, pauses and
    // then drags, and a long press there must not swallow the drag. Inspecting
    // is a long press with no tool (or the tap tool's plain tap).
    if (gesture === 'line' || gesture === 'rect') return;
    pressTimer = setTimeout(() => {
      if ((mode === 'pending' || mode === 'pan') && downTile && pointers.size === 1) {
        mode = 'pressed';
        h.tap?.(downTile, 'long');
      }
    }, LONG_PRESS_MS);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (!p) {
      if (e.pointerType === 'mouse') h.hover?.(tileAt(e.clientX, e.clientY));
      return;
    }
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    if (moved > SLOP) clearPress();
    if (mode === 'pinch' && pointers.size === 2) {
      const q = pinchState();
      const s1 = Math.max(minScale(), Math.min(maxScale(), (pinchFrom.s * q.d) / pinchFrom.d));
      // Keep the world point under the first midpoint under the current midpoint.
      const wx = (pinchFrom.mx - pinchFrom.cx) / pinchFrom.s;
      const wy = (pinchFrom.my - pinchFrom.cy) / pinchFrom.s;
      setCamera(s1, q.mx - wx * s1, q.my - wy * s1);
      return;
    }
    if (mode === 'pan') {
      setCamera(camera.scale.x, panFrom.cx + e.clientX - panFrom.x, panFrom.cy + e.clientY - panFrom.y);
      return;
    }
    if (mode === 'pending' && moved > SLOP / 2 && gesture !== 'tap') mode = 'draw';
    if (mode === 'draw' && downTile) {
      const tile = tileAt(e.clientX, e.clientY);
      if (tile) h.stroke?.(downTile, tile, 'move');
      if (e.pointerType === 'touch') {
        drawPointer = { type: e.pointerType, x: e.clientX, y: e.clientY };
        loupeBox.visible = true;
      }
      dirty = true;
    }
    if (e.pointerType === 'mouse') h.hover?.(tileAt(e.clientX, e.clientY));
  });

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // The capture was already gone.
    }
    clearPress();
    loupeBox.visible = false;
    drawPointer = null;
    dirty = true;
    if (mode === 'pinch') {
      if (pointers.size === 0) mode = 'idle';
      else {
        // One finger left after a pinch pans from here on.
        const [rest] = [...pointers.values()];
        panFrom = { x: rest.x, y: rest.y, cx: camera.position.x, cy: camera.position.y };
        downPos = [rest.x, rest.y];
        mode = 'pan';
      }
      return;
    }
    const wasMode = mode;
    mode = 'idle';
    if (cancelled) {
      if (wasMode === 'draw' && downTile) h.stroke?.(downTile, downTile, 'cancel');
      return;
    }
    const upTile = tileAt(e.clientX, e.clientY);
    if (wasMode === 'draw' && downTile) {
      h.stroke?.(downTile, upTile ?? downTile, 'end');
      return;
    }
    if (wasMode === 'pressed') return;
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    if (moved > SLOP || !upTile) return;
    const now = performance.now();
    if (now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
      lastTap = { at: 0, x: 0, y: 0 };
      fit();
      return;
    }
    lastTap = { at: now, x: e.clientX, y: e.clientY };
    if (wasMode === 'pending' && downTile) h.stroke?.(downTile, downTile, 'end');
    else h.tap?.(upTile, 'tap');
  };
  canvas.addEventListener('pointerup', (e) => finish(e, false));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.has(e.pointerId)) h.hover?.(null);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [px, py] = local(e.clientX, e.clientY);
      // A trackpad pinch arrives as a ctrl-wheel with small deltas; a mouse wheel as steps.
      const factor = e.ctrlKey ? Math.exp(-e.deltaY / 100) : e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(px, py, factor);
    },
    { passive: false },
  );

  function drawLoupe(): void {
    if (!loupeBox.visible || !drawPointer) return;
    const [lx, ly] = local(drawPointer.x, drawPointer.y);
    const s = camera.scale.x * 2;
    const wx = (lx - camera.position.x) / camera.scale.x;
    const wy = (ly - camera.position.y) / camera.scale.x;
    const m = new Matrix(s, 0, 0, s, LOUPE_PX / 2 - wx * s, LOUPE_PX / 2 - wy * s);
    app.renderer.render({ container: world, target: loupeTex, clear: true, transform: m });
    // Above the finger, so the finger never hides what it draws.
    loupeBox.position.set(Math.max(0, Math.min(app.screen.width - LOUPE_PX, lx - LOUPE_PX / 2)), Math.max(0, ly - LOUPE_PX - 48));
  }

  fit();
  return {
    app,
    get projection() {
      return projection;
    },
    get animating() {
      return (decorOn && (puffs.length > 0 || cars.length > 0)) || sparkles.length > 0;
    },
    get deferredAt() {
      return deferred;
    },
    fit,
    focus,
    view: () => ({ s: camera.scale.x, x: camera.position.x, y: camera.position.y }),
    setView: (v) => setCamera(v.s, v.x, v.y),
    tileAt,
    tileToScreen,
    setGesture(g) {
      gesture = g;
    },
    invalidate() {
      lastKey = '';
      lastSig = [];
      lastPaint = -Infinity;
      deferred = null;
    },
    setProjection(p) {
      if (p === projection) return;
      projection = p;
      if (lastModel) paint(lastModel, true);
      paintGhosts();
      fit();
    },
    setGhosts(p) {
      ghosts = p;
      paintGhosts();
    },
    sparkle(tiles) {
      const now = performance.now();
      for (const i of tiles) sparkles.push({ i, at: now });
      dirty = true;
    },
    setDecor(on) {
      if (on === decorOn) return;
      decorOn = on;
      if (lastModel) {
        seedPuffs(lastModel);
        seedCars(lastModel);
      }
      decor.clear();
      traffic.clear();
      dirty = true;
    },
    render(now) {
      const animate = (decorOn && (puffs.length > 0 || cars.length > 0)) || sparkles.length > 0;
      // Animation runs at 30 fps at most (§9.15: decoration is life, not a game loop).
      if (!dirty && !(animate && now - lastFrame >= 33)) return false;
      if (animate) {
        drawDecor(now);
        drawTraffic(Math.min(100, Math.max(0, now - lastFrame)));
        if (sparkles.length) {
          paintGhosts();
          drawSparkles(now);
        }
      }
      paintStale();
      drawLoupe();
      dirty = false;
      lastFrame = now;
      app.render();
      return true;
    },
    update(t, model, key, urgent = false) {
      if (key === lastKey && t === lastTown) {
        deferred = null;
        return false;
      }
      const now = performance.now();
      if (!urgent && t === lastTown && now - lastPaint < REPAINT_MS) {
        // Still due: painted on a later frame, which the loop must ask for (it may otherwise sleep).
        deferred = lastPaint + REPAINT_MS;
        return false;
      }
      deferred = null;
      const parcelsChanged = !lastTown || lastTown.parcels !== t.parcels;
      lastKey = key;
      lastTown = t;
      lastPaint = now;
      const m = model();
      lastIndustry = industryMask(t);
      paint(m, parcelsChanged);
      if (parcelsChanged && !ghosts) fit(t);
      return true;
    },
    resize() {
      // The camera stays where the mayor left it; a double tap fits the town again.
      app.resize();
      dirty = true;
      h.camera?.();
    },
    destroy() {
      clearPress();
      observer?.disconnect();
      app.destroy(true, { children: true });
    },
  };
}

/** 1 where a tile is an Industry zone (smoke comes from these). */
export function industryMask(t: TownState): Uint8Array {
  const use = planesOf(t).use;
  const out = new Uint8Array(use.length);
  for (let i = 0; i < use.length; i++) if (useCat(use[i]) === CAT_ZONE && usePayload(use[i]) === Z_INDUSTRY) out[i] = 1;
  return out;
}
