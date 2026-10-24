// The Pixi v8 painter for the M0 harness: it draws a MapModel top-down, one
// square per tile, and repaints only when the town or the lens changes.
// Interaction is deliberately small: drag to pan, wheel or pinch to zoom,
// hover to inspect a tile.
//
// All the deciding (colours, lens steps, what a tile is) happens in
// model.ts, which is unit-tested; this file only turns that into Graphics.

import { Application, Container, Graphics } from 'pixi.js';
import { MAP, type TownState } from '../engine';
import { mapModel, type Lens, type MapModel } from './model';
import { shade } from './palette';

/** Tile size in world units (the camera scales the whole map). */
export const TILE = 12;
const WORLD = MAP * TILE;

export interface MapView {
  /** Repaints if the town or lens changed since the last call. Returns whether it painted. */
  update(t: TownState, lens: Lens): boolean;
  /** The tile under a client-space point, or null. */
  tileAt(clientX: number, clientY: number): [number, number] | null;
  /** Frames the whole map in the canvas. */
  fit(): void;
  /** Draws a frame if anything changed since the last one (render on demand, §9.15). Returns whether it drew. */
  render(): boolean;
  readonly app: Application;
  destroy(): void;
}

/** A key that changes whenever anything the map draws changes (cheap: these are short strings). */
export function paintKey(t: TownState, lens: Lens): string {
  return [lens, t.planesRev, t.parcels, t.construction.join(','), t.buildings.length, t.buildings.map((b) => b[6]).join(''), lens === 'landValue' ? t.lv : '', lens === 'pollution' ? t.lag.poll : ''].join('|');
}

/** The map is painted in 16 chunks of 16×16 tiles; only chunks whose content changed are rebuilt (§9.15). */
const CHUNK = 16;
const CHUNKS = MAP / CHUNK;
/** While the town is changing every tick, repaint at most this often (ms); a lens change paints at once. */
const REPAINT_MS = 200;

/** A cheap per-chunk signature of everything the chunk draws (tiles plus the buildings anchored in it). */
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
    const k = Math.floor(b.y / CHUNK) * CHUNKS + Math.floor(b.x / CHUNK);
    mixIn(k, b.index ^ (b.x << 8) ^ (b.y << 16) ^ (b.w << 24) ^ (b.h << 28));
    mixIn(k, b.colour ^ (b.building << 24) ^ (b.damaged ? 1 << 31 : 0));
  }
  return sig;
}

export async function createMapView(host: HTMLElement, onHover: (tile: [number, number] | null) => void): Promise<MapView> {
  const app = new Application();
  await app.init({
    background: 0xf3eee3,
    resizeTo: host,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    // Render on demand (§9.15): the page draws a frame only when the map, the camera or the hover changed.
    autoStart: false,
  });
  app.ticker.stop();
  host.appendChild(app.canvas);
  let dirty = true;

  const world = new Container();
  // One Graphics per chunk for the ground and blocks; buildings may span chunks, so they sit above all chunks.
  const chunks: Graphics[] = [];
  const chunkLayer = new Container();
  for (let k = 0; k < CHUNKS * CHUNKS; k++) {
    const g = new Graphics();
    chunks.push(g);
    chunkLayer.addChild(g);
  }
  const civic = new Graphics();
  const hover = new Graphics();
  world.addChild(chunkLayer, civic, hover);
  app.stage.addChild(world);

  let lastKey = '';
  let lastLens: Lens | null = null;
  let lastPaint = -Infinity;
  let lastSig: number[] = [];

  function fit(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    const s = Math.max(0.2, Math.min(w, h) / (WORLD + 2 * TILE));
    world.scale.set(s);
    world.position.set((w - WORLD * s) / 2, (h - WORLD * s) / 2);
    dirty = true;
  }

  function paintChunk(g: Graphics, m: MapModel, cx: number, cy: number): void {
    g.clear();
    for (let ty = cy * CHUNK; ty < (cy + 1) * CHUNK; ty++)
      for (let tx = cx * CHUNK; tx < (cx + 1) * CHUNK; tx++) {
        const i = ty * MAP + tx;
        const x = tx * TILE;
        const y = ty * TILE;
        g.rect(x, y, TILE, TILE).fill(m.ground[i]);
        if (m.scaffold[i]) g.rect(x + 2, y + 2, TILE - 4, TILE - 4).stroke({ width: 1, color: 0x8a6d3b, alpha: 0.9 });
        const lv = m.level[i];
        if (!lv) continue;
        // A block grows with its level; a darker band on top stands for height.
        const inset = Math.max(1, 4 - lv);
        const size = TILE - inset * 2;
        g.rect(x + inset, y + inset, size, size).fill(m.block[i]);
        g.rect(x + inset, y + inset, size, Math.min(size, 1 + lv)).fill(shade(m.block[i], 0.78));
        // Wealth trim: ££ a pale edge, £££ a bright one.
        if (m.tier[i] > 0) g.rect(x + inset, y + inset, size, size).stroke({ width: 1, color: m.tier[i] === 2 ? 0xfff6d5 : 0xf4e3cf, alpha: 0.9 });
      }
  }

  function paint(m: MapModel): void {
    const sig = chunkSignatures(m);
    for (let k = 0; k < sig.length; k++) {
      if (sig[k] === lastSig[k]) continue;
      paintChunk(chunks[k], m, k % CHUNKS, Math.floor(k / CHUNKS));
    }
    lastSig = sig;
    dirty = true;
    civic.clear();
    for (const b of m.buildings) {
      const x = b.x * TILE + 1;
      const y = b.y * TILE + 1;
      const w = b.w * TILE - 2;
      const h = b.h * TILE - 2;
      const alpha = b.building > 0 ? 0.45 : 1;
      civic.rect(x, y, w, h).fill({ color: b.colour, alpha }).stroke({ width: 1, color: 0x5b4a3a, alpha: 0.8 });
      if (b.damaged) civic.circle(x + w / 2, y + h / 2, Math.min(w, h) / 4).fill(0x7a7a7a);
    }
  }

  // Pan and zoom.
  let drag: { x: number; y: number; wx: number; wy: number } | null = null;
  const canvas = app.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, wx: world.position.x, wy: world.position.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    drag = null;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) world.position.set(drag.wx + e.clientX - drag.x, drag.wy + e.clientY - drag.y);
    const tile = tileAt(e.clientX, e.clientY);
    dirty = true;
    hover.clear();
    if (tile) hover.rect(tile[0] * TILE, tile[1] * TILE, TILE, TILE).stroke({ width: 1.5, color: 0x1d1d1d });
    onHover(tile);
  });
  canvas.addEventListener('pointerleave', () => {
    hover.clear();
    dirty = true;
    onHover(null);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const s0 = world.scale.x;
      const s1 = Math.max(0.2, Math.min(8, s0 * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      world.position.set(px - ((px - world.position.x) * s1) / s0, py - ((py - world.position.y) * s1) / s0);
      world.scale.set(s1);
      dirty = true;
    },
    { passive: false },
  );

  function tileAt(clientX: number, clientY: number): [number, number] | null {
    const r = canvas.getBoundingClientRect();
    const s = world.scale.x;
    const x = Math.floor((clientX - r.left - world.position.x) / s / TILE);
    const y = Math.floor((clientY - r.top - world.position.y) / s / TILE);
    return x >= 0 && y >= 0 && x < MAP && y < MAP ? [x, y] : null;
  }

  fit();
  return {
    app,
    fit,
    tileAt,
    render() {
      if (!dirty) return false;
      dirty = false;
      app.render();
      return true;
    },
    update(t, lens) {
      const key = paintKey(t, lens);
      if (key === lastKey) return false;
      const now = performance.now();
      if (lens === lastLens && now - lastPaint < REPAINT_MS) return false; // still dirty: painted on a later frame
      lastKey = key;
      lastLens = lens;
      lastPaint = now;
      paint(mapModel(t, lens));
      return true;
    },
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
