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

import { Application, Container, Graphics, Matrix, RenderTexture, Sprite } from 'pixi.js';
import { CAT_ZONE, MAP, Z_INDUSTRY, parcelOf, planesOf, useCat, usePayload, type TownState } from '../engine';
import type { GhostMark, PlanPreview } from '../plan/plan';
import { type MapModel } from './model';
import { shade } from './palette';

export type Projection = 'iso' | 'top';

/** Top-down tile size in world units. */
export const TILE = 12;
/** Isometric half-width and half-height of a tile diamond (2:1). */
export const HW = 12;
export const HH = 6;
/** Isometric block height by development level (L0–L5), world units. */
const LEVEL_HEIGHT = [0, 5, 9, 15, 24, 38];

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
  tileAt(clientX: number, clientY: number): [number, number] | null;
  /** A tile centre in CSS px relative to the map's host (DOM overlays). */
  tileToScreen(x: number, y: number): [number, number];
  /** Forgets what was painted, so the next update repaints every chunk. */
  invalidate(): void;
  /** Draws a frame if anything changed or something animates. Returns whether it drew. */
  render(now: number): boolean;
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
  }
  for (const b of m.buildings) {
    const k = chunkOfFront(b.x, b.y, b.w, b.h);
    mixIn(k, b.index ^ (b.x << 8) ^ (b.y << 16) ^ (b.w << 24) ^ (b.h << 28));
    mixIn(k, b.colour ^ (b.building << 24) ^ (b.damaged ? 1 << 31 : 0));
  }
  return sig;
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
  });
  app.ticker.stop();
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
  const structureLayer = new Container();
  const grounds: Graphics[] = [];
  const structures: Graphics[] = [];
  for (let k = 0; k < CHUNKS * CHUNKS; k++) {
    grounds.push(groundLayer.addChild(new Graphics()));
    structures.push(new Graphics());
  }
  // Isometric painter's order: chunks back to front by cx + cy.
  const order = [...Array(CHUNKS * CHUNKS).keys()].sort((a, b) => (a % CHUNKS) + Math.floor(a / CHUNKS) - ((b % CHUNKS) + Math.floor(b / CHUNKS)) || a - b);
  for (const k of order) structureLayer.addChild(structures[k]);
  const ghostLayer = new Graphics();
  const overlay = new Graphics();
  const decor = new Graphics();
  world.addChild(groundLayer, ghostLayer, structureLayer, decor, overlay);
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
  let lastSig: number[] = [];
  let lastModel: MapModel | null = null;
  let lastTown: TownState | null = null;
  let ghosts: PlanPreview | null = null;
  let sparkles: { i: number; at: number }[] = [];
  let puffs: { x: number; y: number; phase: number }[] = [];
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

  /** A box over tiles [x, x + w) × [y, y + h), `height` world units tall (isometric), or a flat rect (top-down). */
  function box(g: Graphics, x: number, y: number, w: number, hgt: number, height: number, colour: number, alpha = 1, inset = 0.12): void {
    if (projection === 'top') {
      const ins = inset * TILE;
      g.rect(x * TILE + ins, y * TILE + ins, w * TILE - 2 * ins, hgt * TILE - 2 * ins).fill({ color: colour, alpha });
      g.rect(x * TILE + ins, y * TILE + ins, w * TILE - 2 * ins, Math.min(hgt * TILE - 2 * ins, 1 + height / 6)).fill({ color: shade(colour, 0.78), alpha });
      return;
    }
    const [ax, ay] = corner(x + inset, y + inset);
    const [bx, by] = corner(x + w - inset, y + inset);
    const [cx, cy] = corner(x + w - inset, y + hgt - inset);
    const [dx, dy] = corner(x + inset, y + hgt - inset);
    // Left face (d → c, lifted), right face (c → b, lifted), then the roof.
    g.poly([dx, dy, cx, cy, cx, cy - height, dx, dy - height]).fill({ color: shade(colour, 0.82), alpha });
    g.poly([cx, cy, bx, by, bx, by - height, cx, cy - height]).fill({ color: shade(colour, 0.66), alpha });
    // No outline: three shaded faces read as a block, and a stroke would triple the triangles per roof.
    g.poly([ax, ay - height, bx, by - height, cx, cy - height, dx, dy - height]).fill({ color: colour, alpha });
  }

  function paintGround(g: Graphics, m: MapModel, cx: number, cy: number): void {
    g.clear();
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++)
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const i = ty * MAP + tx;
        if (projection === 'top') g.rect(tx * TILE, ty * TILE, TILE, TILE).fill(m.ground[i]);
        else g.poly(diamond(tx, ty)).fill(m.ground[i]);
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

  function paintStructures(g: Graphics, m: MapModel, k: number): void {
    g.clear();
    const cx = k % CHUNKS;
    const cy = Math.floor(k / CHUNKS);
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++)
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const i = ty * MAP + tx;
        const lv = m.level[i];
        if (!lv) continue;
        items.push({
          depth: tx + ty,
          draw: () => {
            const height = LEVEL_HEIGHT[lv] ?? 10;
            box(g, tx, ty, 1, 1, height, m.block[i], 1, Math.max(0.08, 0.3 - 0.04 * lv));
            if (m.tier[i] > 0 && projection === 'iso') {
              const [ax, ay] = corner(tx + 0.3, ty + 0.3);
              g.circle(ax, ay - height - 1, 1.2).fill(m.tier[i] === 2 ? 0x7fc8a9 : 0xf4e3cf); // roof gardens and bay trim
            }
            if (m.scaffold[i]) box(g, tx, ty, 1, 1, height + 3, 0x8a6d3b, 0.25, 0.1);
          },
        });
      }
    for (const b of m.buildings) {
      if (chunkOfFront(b.x, b.y, b.w, b.h) !== k) continue;
      items.push({
        depth: b.x + b.w - 1 + b.y + b.h - 1,
        draw: () => {
          const height = 8 + 4 * Math.min(b.w, b.h);
          const alpha = b.building > 0 ? 0.5 : 1;
          box(g, b.x, b.y, b.w, b.h, height, b.colour, alpha, 0.08);
          if (b.building > 0) box(g, b.x, b.y, b.w, b.h, height + 4, 0x8a6d3b, 0.22, 0.04);
          if (b.damaged) {
            const [px, py] = corner(b.x + b.w / 2, b.y + b.h / 2);
            g.circle(px, py - height - 4, 3).fill({ color: 0x7a7a7a, alpha: 0.85 });
          }
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }

  function paint(m: MapModel, force: boolean): void {
    const sig = chunkSignatures(m);
    for (let k = 0; k < sig.length; k++) {
      if (!force && sig[k] === lastSig[k]) continue;
      paintGround(grounds[k], m, k % CHUNKS, Math.floor(k / CHUNKS));
      paintStructures(structures[k], m, k);
    }
    lastSig = sig;
    lastModel = m;
    seedPuffs(m);
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
      // Industry blocks (ZONE_BUILT[3] family) at level 1–4 smoke; level-5 makers' sheds are clean (§9.15).
      if (m.level[i] > 0 && m.level[i] < 5 && lastIndustry?.[i] === 1) puffs.push({ x: i % MAP, y: Math.floor(i / MAP), phase: (i * 37) % 100 });
    }
  }


  function drawDecor(now: number): void {
    decor.clear();
    if (!decorOn || !lastModel) return;
    for (const p of puffs) {
      const lv = lastModel.level[p.y * MAP + p.x];
      const [px, py] = corner(p.x + 0.5, p.y + 0.5);
      const top = py - (LEVEL_HEIGHT[lv] ?? 8) - 2;
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
    h.camera?.();
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
      return (decorOn && puffs.length > 0) || sparkles.length > 0;
    },
    fit,
    focus,
    tileAt,
    tileToScreen,
    setGesture(g) {
      gesture = g;
    },
    invalidate() {
      lastKey = '';
      lastSig = [];
      lastPaint = -Infinity;
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
      if (lastModel) seedPuffs(lastModel);
      decor.clear();
      dirty = true;
    },
    render(now) {
      const animate = (decorOn && puffs.length > 0) || sparkles.length > 0;
      // Animation runs at 30 fps at most (§9.15: decoration is life, not a game loop).
      if (!dirty && !(animate && now - lastFrame >= 33)) return false;
      if (animate) {
        drawDecor(now);
        if (sparkles.length) {
          paintGhosts();
          drawSparkles(now);
        }
      }
      drawLoupe();
      dirty = false;
      lastFrame = now;
      app.render();
      return true;
    },
    update(t, model, key, urgent = false) {
      if (key === lastKey && t === lastTown) return false;
      const now = performance.now();
      if (!urgent && t === lastTown && now - lastPaint < REPAINT_MS) return false; // still due: painted on a later frame
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
