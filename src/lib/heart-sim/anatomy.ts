// Heart anatomy as analytical SDF primitives.
//
// Convention: SDF is POSITIVE inside the cavity (where blood flows),
// NEGATIVE outside (in muscle / void). Union is a smooth-max.
//
// World space: a 100×120 portrait box (heart silhouette). Renderer maps
// to screen with aspect-fit. Apex of the heart points to viewer's
// lower-right (anterior view, standard medical convention: patient's
// left = viewer's right). The heart is a single tight kidney-shaped
// silhouette — chambers physically overlap and great vessels are short
// stubs that emerge above the atria. No vessel reaches the world edge
// horizontally; particles drain at the very top of the canvas where the
// fade mask has already faded them out.

export type ChamberId = 'RA' | 'RV' | 'LA' | 'LV';
export type ValveId = 'tricuspid' | 'mitral' | 'pulmonary' | 'aortic';

export interface Vec2 { x: number; y: number; }

// --- SDF primitives (positive-inside) -------------------------------------

export type Prim = (x: number, y: number) => number;

export function disk(cx: number, cy: number, r: number): Prim {
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    return r - Math.sqrt(dx * dx + dy * dy);
  };
}

export function capsule(ax: number, ay: number, bx: number, by: number, r: number): Prim {
  const bax = bx - ax, bay = by - ay;
  const len2 = bax * bax + bay * bay || 1;
  return (x, y) => {
    const pax = x - ax, pay = y - ay;
    let h = (pax * bax + pay * bay) / len2;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h;
    return r - Math.sqrt(dx * dx + dy * dy);
  };
}

// Smooth max (union for positive-inside SDFs).
// Larger k = smoother joins between primitives.
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (a - b) / k));
  return a * h + b * (1 - h) + k * h * (1 - h);
}

export function unionAll(prims: Prim[], k: number): Prim {
  return (x, y) => {
    let acc = -1e9;
    for (let i = 0; i < prims.length; i++) {
      acc = smax(acc, prims[i](x, y), k);
    }
    return acc;
  };
}

// --- Heart geometry --------------------------------------------------------

export const WORLD_X = 100;
export const WORLD_Y = 120;
export const WORLD = WORLD_Y;

// Chambers physically overlap in x at the septum so the heart reads as one
// continuous mass with no visible whitespace between left and right sides.
// Atria sit on top of ventricles, joined by AV-valve capsules below.
export const CHAMBERS: Record<ChamberId, Prim[]> = {
  // Right atrium — viewer's upper-left.
  RA: [
    disk(38, 88, 12),
    disk(31, 82, 9),
    disk(46, 80, 8),
  ],
  // Right ventricle — viewer's middle-left, smaller crescent.
  RV: [
    disk(40, 60, 12),
    disk(33, 48, 11),
    disk(36, 36, 9),
    disk(43, 28, 7),
  ],
  // Left atrium — viewer's upper-right, OVERLAPS RA at the septum.
  LA: [
    disk(60, 88, 12),
    disk(67, 82, 9),
    disk(52, 80, 8),
  ],
  // Left ventricle — large, forms the apex at viewer's lower-right.
  // First disk overlaps RV at the septum so the ventricles fuse visually.
  LV: [
    disk(56, 60, 13),
    disk(60, 48, 13),
    disk(64, 36, 12),
    disk(70, 24, 10),
    disk(76, 13, 8),  // apex
  ],
};

// Tighter union than before — the heart silhouette stays crisp and
// kidney-shaped instead of blobby.
export const SMOOTH_K = 1.4;

// --- Valves ----------------------------------------------------------------
//
// AV valves bridge the atrial mass (y≈80) to the ventricular mass (y≈50).
// Semilunar valves bridge the ventricles (y≈50) to the great-vessel stubs
// rising up through the atrial region.

export interface ValveDef {
  id: ValveId;
  passage: Prim;
  ax: number; ay: number; bx: number; by: number;
  flowX: number; flowY: number;
}

function unitFromTo(ax: number, ay: number, bx: number, by: number): Vec2 {
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

function makeValve(id: ValveId, ax: number, ay: number, bx: number, by: number, r: number): ValveDef {
  const f = unitFromTo(ax, ay, bx, by);
  return { id, passage: capsule(ax, ay, bx, by, r), ax, ay, bx, by, flowX: f.x, flowY: f.y };
}

// Valve capsules are always-on in the SDF — keeping the heart visually
// continuous. Cardiac flow direction is enforced by the force field, not
// by SDF gating.
export const VALVES: Record<ValveId, ValveDef> = {
  // AV valves — atria → ventricles.
  tricuspid: makeValve('tricuspid', 40, 78, 38, 53, 4.0),
  mitral:    makeValve('mitral',    58, 78, 58, 53, 4.0),
  // Semilunar valves — ventricles → outflow tracts. Top endpoint sits
  // inside the great-vessel stub above (overlapping the trunk capsule).
  pulmonary: makeValve('pulmonary', 35, 50, 35, 90, 3.2),
  aortic:    makeValve('aortic',    58, 50, 58, 90, 3.2),
};

// --- Vessels ---------------------------------------------------------------
//
// All vessels are SHORT stubs contained within the world. Great vessels
// (aorta, pulm trunk) rise out of the top of the ventricles and emerge
// through the upper edge of the atrial mass. Returns (SVC, pulm vein)
// drop into the atria from the upper corners. Drains and spawns happen
// at y=110+ where the fade mask has already faded particles to zero —
// teleportation is invisible.

export interface VesselSeg {
  ax: number; ay: number; bx: number; by: number; r: number;
  loop: 0 | 1;
}

export const VESSEL_SEGS: VesselSeg[] = [
  // Each great-vessel = narrow stub + a wide bell that EXTENDS PAST THE
  // WORLD TOP (y=120). No SDF ceiling, so particles flow freely upward
  // through the bell and out into the fade zone. They become 100%
  // transparent by y≈110, then drain (invisibly) before the world clamp.
  // --- Pulmonary loop ---
  // SVC stub + bell extending past world top, fanned LEFT for separation
  // from the pulm-trunk drain.
  { ax: 30, ay: 100, bx: 34, by: 88, r: 2.6, loop: 1 },
  { ax: 18, ay: 130, bx: 34, by: 100, r: 5.5, loop: 1 },
  // Pulmonary trunk stub + bell extending past world top.
  { ax: 35, ay: 50,  bx: 35, by: 100, r: 2.8, loop: 1 },
  { ax: 35, ay: 100, bx: 35, by: 130, r: 5.5, loop: 1 },

  // --- Systemic loop ---
  // Pulmonary vein stub + bell extending past world top, fanned RIGHT.
  { ax: 70, ay: 100, bx: 64, by: 88, r: 2.6, loop: 0 },
  { ax: 82, ay: 130, bx: 66, by: 100, r: 5.5, loop: 0 },
  // Ascending aorta stub + bell extending past world top.
  { ax: 58, ay: 50,  bx: 58, by: 100, r: 3.0, loop: 0 },
  { ax: 58, ay: 100, bx: 58, by: 130, r: 5.5, loop: 0 },
];

export const VESSELS: Prim[] = VESSEL_SEGS.map((v) => capsule(v.ax, v.ay, v.bx, v.by, v.r));

// --- Drains & sources for closed-loop circulation -------------------------
//
// A particle on the systemic loop drains at the end of the aortic arch
// and respawns at the top of the SVC — visually it "leaves the body
// through the aorta and returns via the vena cava". Same for pulmonary.
// Both teleport points sit at y≥110 where the fade mask reads ~0, so the
// jump is hidden inside the canvas's own fade-out.

export interface LoopEnd {
  drainX: number; drainY: number; drainR: number;
  spawnX: number; spawnY: number; spawnDirX: number; spawnDirY: number;
}

export const LOOPS: { systemic: LoopEnd; pulmonary: LoopEnd } = {
  systemic: {
    // Drain at the top of the aortic bell (100% transparent). Particle is
    // destroyed here and a fresh one is spawned inside the LV.
    drainX: 58, drainY: 116, drainR: 9,
    // Spawn deep in the LV — the new particle will be ejected back up
    // the aorta on the next ventricular ejection.
    spawnX: 65, spawnY: 36, spawnDirX: 0, spawnDirY: 0,
  },
  pulmonary: {
    drainX: 35, drainY: 116, drainR: 9,
    // Spawn deep in the RV.
    spawnX: 38, spawnY: 43, spawnDirX: 0, spawnDirY: 0,
  },
};

// --- Cavity SDF builders ---------------------------------------------------

export interface ValveStates {
  tricuspid: boolean; mitral: boolean; pulmonary: boolean; aortic: boolean;
}

export function buildCavitySDF(open: ValveStates): Prim {
  // Valves are ALWAYS in the SDF so the heart reads as one continuous unit.
  // Cardiac flow direction is enforced by the force field, not SDF gating.
  void open;
  const prims: Prim[] = [];
  for (const id of ['RA', 'RV', 'LA', 'LV'] as ChamberId[]) {
    prims.push(...CHAMBERS[id]);
  }
  prims.push(...VESSELS);
  for (const id of ['tricuspid', 'mitral', 'pulmonary', 'aortic'] as ValveId[]) {
    prims.push(VALVES[id].passage);
  }
  return unionAll(prims, SMOOTH_K);
}

// --- Chamber classification (for force application) -----------------------

export function classifyChamber(x: number, y: number): ChamberId | null {
  let best: ChamberId | null = null;
  let bestSd = 0;
  for (const id of ['RA', 'RV', 'LA', 'LV'] as ChamberId[]) {
    let sd = -1e9;
    for (const p of CHAMBERS[id]) sd = smax(sd, p(x, y), SMOOTH_K);
    if (sd > bestSd) { bestSd = sd; best = id; }
  }
  return best;
}

// --- Wall-fade mask --------------------------------------------------------
//
// Grayscale alpha matching the world. 1.0 deep inside cavity, 0.0 outside.
// Particles fade out completely before reaching any wall, hiding the SDF
// boundary entirely. Particles also fade as they approach the canvas edge
// (drain/spawn region above y=110) hiding the loop teleport.

const FADE_RES_X = 256;
const FADE_RES_Y = 320;
const FADE_RANGE = 3.0;

export function buildFadeMask(): { data: Uint8Array; width: number; height: number } {
  const sdf = buildCavitySDF({ tricuspid: true, mitral: true, pulmonary: true, aortic: true });
  const data = new Uint8Array(FADE_RES_X * FADE_RES_Y);
  const stepX = WORLD_X / FADE_RES_X;
  const stepY = WORLD_Y / FADE_RES_Y;
  for (let j = 0; j < FADE_RES_Y; j++) {
    const y = (j + 0.5) * stepY;
    const row = j * FADE_RES_X;
    for (let i = 0; i < FADE_RES_X; i++) {
      const x = (i + 0.5) * stepX;
      const sd = sdf(x, y);
      const t = sd <= 0 ? 0 : sd >= FADE_RANGE ? 1 : sd / FADE_RANGE;
      let s = t * t * (3 - 2 * t);
      // Vertical fade band over the vessel bells: particles fan out and
      // gradually become 100% transparent before reaching the drain at
      // y=116. Looks like blood flowing out into nothing.
      if (y > 96) {
        const edgeT = Math.max(0, Math.min(1, (110 - y) / 14));
        s *= edgeT * edgeT * (3 - 2 * edgeT);
      }
      data[row + i] = (s * 255) | 0;
    }
  }
  return { data, width: FADE_RES_X, height: FADE_RES_Y };
}
