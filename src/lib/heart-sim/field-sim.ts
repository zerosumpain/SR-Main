// Field-driven advection sim — alternative architecture for /heart/2.
//
// Instead of PBF (which is O(N · neighbours) and got expensive in dense
// chambers), this approach pre-bakes a velocity field per cardiac phase.
// Each frame:
//   1. Compute phase weights from cycle position (bell curves over the
//      6-phase cycle).
//   2. Per particle: sample all four mode fields, blend by weights, push
//      velocity toward the target with inertia, advect.
//   3. SDF boundary push + soft repel + loop recycle (reused).
//   4. Coarse density grid → separation gradient (cheap pressure relief
//      so particles don't pile into singular convergence points).
//
// Cost is dominated by ~4 bilerp samples per particle per frame. ~30× faster
// than PBF, so this comfortably handles 15–20k particles at 60fps.

import {
  WORLD_X, WORLD_Y,
  VALVES, VESSEL_SEGS, LOOPS,
  buildCavitySDF, classifyChamber,
  type ChamberId, type Prim,
} from './anatomy';
import { ParticleRenderer } from './renderer';

// --- Static SDF (reused for boundary pushes) ------------------------------

const SDF_STEP = 0.55;
const SDF_RES_X = Math.ceil(WORLD_X / SDF_STEP);
const SDF_RES_Y = Math.ceil(WORLD_Y / SDF_STEP);
const SDF_INV_STEP = 1 / SDF_STEP;

class SDFGrid {
  data: Float32Array;
  constructor(prim: Prim) {
    this.data = new Float32Array(SDF_RES_X * SDF_RES_Y);
    for (let j = 0; j < SDF_RES_Y; j++) {
      const y = (j + 0.5) * SDF_STEP;
      for (let i = 0; i < SDF_RES_X; i++) {
        this.data[j * SDF_RES_X + i] = prim((i + 0.5) * SDF_STEP, y);
      }
    }
  }
  sample(x: number, y: number): number {
    const fx = x * SDF_INV_STEP - 0.5;
    const fy = y * SDF_INV_STEP - 0.5;
    if (fx < 0 || fy < 0 || fx >= SDF_RES_X - 1 || fy >= SDF_RES_Y - 1) return -10;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const d = this.data;
    const r = iy * SDF_RES_X + ix;
    const a = d[r], b = d[r + 1], c = d[r + SDF_RES_X], dd = d[r + SDF_RES_X + 1];
    const ab = a + (b - a) * tx;
    const cd = c + (dd - c) * tx;
    return ab + (cd - ab) * ty;
  }
}

// --- Velocity field -------------------------------------------------------

const FIELD_STEP = 1.4;
const FIELD_RES_X = Math.ceil(WORLD_X / FIELD_STEP);
const FIELD_RES_Y = Math.ceil(WORLD_Y / FIELD_STEP);
const FIELD_INV_STEP = 1 / FIELD_STEP;

type Field = Float32Array; // length = RES_X * RES_Y * 2 (vx, vy interleaved)

type FieldGen = (x: number, y: number) => [number, number];

function buildField(gens: FieldGen[]): Field {
  const data = new Float32Array(FIELD_RES_X * FIELD_RES_Y * 2);
  for (let j = 0; j < FIELD_RES_Y; j++) {
    const y = (j + 0.5) * FIELD_STEP;
    for (let i = 0; i < FIELD_RES_X; i++) {
      const x = (i + 0.5) * FIELD_STEP;
      let vx = 0, vy = 0;
      for (let g = 0; g < gens.length; g++) {
        const v = gens[g](x, y);
        vx += v[0]; vy += v[1];
      }
      const idx = (j * FIELD_RES_X + i) * 2;
      data[idx] = vx;
      data[idx + 1] = vy;
    }
  }
  return data;
}

function sampleField(f: Field, x: number, y: number, out: [number, number]): void {
  const fx = x * FIELD_INV_STEP - 0.5;
  const fy = y * FIELD_INV_STEP - 0.5;
  if (fx < 0 || fy < 0 || fx >= FIELD_RES_X - 1 || fy >= FIELD_RES_Y - 1) {
    out[0] = 0; out[1] = 0; return;
  }
  const ix = fx | 0, iy = fy | 0;
  const tx = fx - ix, ty = fy - iy;
  const r = (iy * FIELD_RES_X + ix) * 2;
  const stride = FIELD_RES_X * 2;
  const ax = f[r],     ay = f[r + 1];
  const bx = f[r + 2], by = f[r + 3];
  const cx = f[r + stride],     cy = f[r + stride + 1];
  const dx = f[r + stride + 2], dy = f[r + stride + 3];
  const abx = ax + (bx - ax) * tx, aby = ay + (by - ay) * tx;
  const cdx = cx + (dx - cx) * tx, cdy = cy + (dy - cy) * tx;
  out[0] = abx + (cdx - abx) * ty;
  out[1] = aby + (cdy - aby) * ty;
}

// --- Field generators (declarative anatomy → vectors) --------------------

function chamberToward(chamber: ChamberId, tx: number, ty: number, mag: number): FieldGen {
  return (x, y) => {
    const ch = classifyChamber(x, y);
    if (ch !== chamber) return [0, 0];
    const dx = tx - x, dy = ty - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [(dx / len) * mag, (dy / len) * mag];
  };
}

function chamberRadial(chamber: ChamberId, cx: number, cy: number, mag: number): FieldGen {
  // Inward push from a centre — used to collapse particles inward during
  // ventricular contraction (ejection).
  return (x, y) => {
    const ch = classifyChamber(x, y);
    if (ch !== chamber) return [0, 0];
    const dx = cx - x, dy = cy - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [(dx / len) * mag, (dy / len) * mag];
  };
}

interface VSeg { ax: number; ay: number; bx: number; by: number; r: number; bax: number; bay: number; len2: number; segLen: number; dirX: number; dirY: number; }
function makeVSeg(ax: number, ay: number, bx: number, by: number, r: number): VSeg {
  const bax = bx - ax, bay = by - ay;
  const segLen = Math.sqrt(bax * bax + bay * bay) || 1;
  return { ax, ay, bx, by, r, bax, bay, len2: segLen * segLen, segLen, dirX: bax / segLen, dirY: bay / segLen };
}

function pathFlow(segs: VSeg[], mag: number): FieldGen {
  return (x, y) => {
    for (let i = 0; i < segs.length; i++) {
      const v = segs[i];
      const pax = x - v.ax, pay = y - v.ay;
      const h = (pax * v.bax + pay * v.bay) / v.len2;
      if (h < 0 || h > 1) continue;
      const dx = pax - v.bax * h, dy = pay - v.bay * h;
      if (dx * dx + dy * dy < v.r * v.r) {
        return [v.dirX * mag, v.dirY * mag];
      }
    }
    return [0, 0];
  };
}

// Tight layout — VESSEL_SEGS pairs of (stub, bell):
//   0=SVC stub, 1=SVC bell, 2=pulm trunk stub, 3=pulm trunk bell,
//   4=pulm vein stub, 5=pulm vein bell, 6=aorta stub, 7=aorta bell.
const SVC_SEG       = makeVSeg(VESSEL_SEGS[0].ax, VESSEL_SEGS[0].ay, VESSEL_SEGS[0].bx, VESSEL_SEGS[0].by, VESSEL_SEGS[0].r);
const IVC_SEG       = SVC_SEG;
const PULM_TRUNK    = makeVSeg(VESSEL_SEGS[2].ax, VESSEL_SEGS[2].ay, VESSEL_SEGS[2].bx, VESSEL_SEGS[2].by, VESSEL_SEGS[2].r);
const PULM_VEIN_1   = makeVSeg(VESSEL_SEGS[4].ax, VESSEL_SEGS[4].ay, VESSEL_SEGS[4].bx, VESSEL_SEGS[4].by, VESSEL_SEGS[4].r);
const PULM_VEIN_2   = PULM_VEIN_1;
const AORTA = [
  makeVSeg(VESSEL_SEGS[6].ax, VESSEL_SEGS[6].ay, VESSEL_SEGS[6].bx, VESSEL_SEGS[6].by, VESSEL_SEGS[6].r),
];

// AV-valve passages as cap segments — used to drive A→V flow during filling.
const TRICUSPID_SEG = makeVSeg(VALVES.tricuspid.ax, VALVES.tricuspid.ay, VALVES.tricuspid.bx, VALVES.tricuspid.by, 4);
const MITRAL_SEG    = makeVSeg(VALVES.mitral.ax,    VALVES.mitral.ay,    VALVES.mitral.bx,    VALVES.mitral.by, 4);

// Ventricle apex/centre points used for contraction radial.
const RV_C = { x: 38.0, y: 43.0 };
const LV_C = { x: 65.0, y: 36.0 };

// --- Pre-bake the four mode fields ----------------------------------------

const F_REST = buildField([
  // Veins: slow continuous return to heart.
  pathFlow([SVC_SEG], 14),
  pathFlow([IVC_SEG], 12),
  pathFlow([PULM_VEIN_1], 16),
  pathFlow([PULM_VEIN_2], 16),
  // Arteries: minimal residual outflow.
  pathFlow(AORTA, 6),
  pathFlow([PULM_TRUNK], 5),
]);

const F_ATRIAL = buildField([
  // Atrial kick — atria push into the ventricles via AV valves.
  chamberToward('RA', VALVES.tricuspid.bx, VALVES.tricuspid.by, 22),
  chamberToward('LA', VALVES.mitral.bx,    VALVES.mitral.by,    26),
  // AV valve passage flow.
  pathFlow([TRICUSPID_SEG], 18),
  pathFlow([MITRAL_SEG],    20),
  // Veins continue feeding atria.
  pathFlow([SVC_SEG], 14),
  pathFlow([IVC_SEG], 12),
  pathFlow([PULM_VEIN_1], 16),
  pathFlow([PULM_VEIN_2], 16),
]);

const F_EJECTION = buildField([
  // Ventricles squeeze toward outflow valves AND contract radially.
  chamberToward('RV', VALVES.pulmonary.bx, VALVES.pulmonary.by, 80),
  chamberToward('LV', VALVES.aortic.bx,    VALVES.aortic.by,    95),
  chamberRadial('RV', RV_C.x, RV_C.y, 18),
  chamberRadial('LV', LV_C.x, LV_C.y, 22),
  // Arteries: powerful outflow.
  pathFlow(AORTA, 95),
  pathFlow([PULM_TRUNK], 75),
  // Veins still feeding (passive return doesn't pause).
  pathFlow([SVC_SEG], 14),
  pathFlow([IVC_SEG], 12),
  pathFlow([PULM_VEIN_1], 16),
  pathFlow([PULM_VEIN_2], 16),
]);

const F_FILLING = buildField([
  // Strong passive A→V flow.
  chamberToward('RA', VALVES.tricuspid.bx, VALVES.tricuspid.by, 14),
  chamberToward('LA', VALVES.mitral.bx,    VALVES.mitral.by,    16),
  pathFlow([TRICUSPID_SEG], 22),
  pathFlow([MITRAL_SEG],    24),
  // Veins continue.
  pathFlow([SVC_SEG], 16),
  pathFlow([IVC_SEG], 14),
  pathFlow([PULM_VEIN_1], 18),
  pathFlow([PULM_VEIN_2], 18),
  // Arterial residual.
  pathFlow(AORTA, 8),
  pathFlow([PULM_TRUNK], 7),
]);

// --- Cardiac phase weights ------------------------------------------------

function bell(p: number, c: number, w: number): number {
  let d = Math.abs(p - c);
  if (d > 0.5) d = 1 - d;
  const t = d / w;
  return Math.exp(-t * t);
}

function cardiacWeights(phi: number): { rest: number; atr: number; ej: number; fill: number } {
  // Bell curves centred on each phase's peak.
  const atr  = bell(phi, 0.05, 0.05);   // atrial systole 0–0.10, peak 0.05
  const ej   = bell(phi, 0.30, 0.10);   // ejection 0.15–0.45, peak 0.30
  const fill = bell(phi, 0.62, 0.12);   // filling 0.55–0.75, peak 0.62
  // Rest fills the rest (literally) — use whatever's left, never below 0.
  const restRaw = Math.max(0, 1 - (atr + ej + fill));
  const sum = atr + ej + fill + restRaw + 1e-6;
  return { atr: atr / sum, ej: ej / sum, fill: fill / sum, rest: restRaw / sum };
}

// Phase label for UI (most-active mode at the current phi).
function activePhase(phi: number): string {
  const w = cardiacWeights(phi);
  let best = 'rest', v = w.rest;
  if (w.atr > v)  { best = 'atrialSystole'; v = w.atr; }
  if (w.ej > v)   { best = 'ejection';      v = w.ej; }
  if (w.fill > v) { best = 'filling';       v = w.fill; }
  return best;
}

// --- Coarse density grid (cheap pressure relief) --------------------------

const D_STEP = 2.5;
const D_RES_X = Math.ceil(WORLD_X / D_STEP);
const D_RES_Y = Math.ceil(WORLD_Y / D_STEP);
const D_INV_STEP = 1 / D_STEP;

// --- The solver -----------------------------------------------------------

const PARTICLE_R = 0.7;
const SOFT_REPEL_RANGE = 1.6;
const SOFT_REPEL_K = 0.06;
const VEL_INERTIA = 0.78;          // higher = laggier; fields blend in slowly
const SEPARATION_K = 6.0;          // density-gradient repel strength

export class FieldHeartSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private renderer: ParticleRenderer;
  private sdf: SDFGrid;

  pos: Float32Array;
  vel: Float32Array;
  loop: Int8Array;
  count: number;

  private density: Float32Array;     // coarse grid for separation
  private bpm: number;
  private t = 0;
  private raf = 0;
  private lastT = 0;
  private running = false;

  fps = 0;
  msSolve = 0;
  msRender = 0;
  cyclePhi = 0;
  phaseLabel = 'rest';

  constructor(opts: { canvas: HTMLCanvasElement; particleCount?: number; bpm?: number }) {
    this.canvas = opts.canvas;
    this.bpm = opts.bpm ?? 70;
    this.count = opts.particleCount ?? 12000;
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.renderer = new ParticleRenderer(gl);

    this.sdf = new SDFGrid(buildCavitySDF({ tricuspid: true, mitral: true, pulmonary: true, aortic: true }));

    this.pos = new Float32Array(this.count * 2);
    this.vel = new Float32Array(this.count * 2);
    this.loop = new Int8Array(this.count);
    this.density = new Float32Array(D_RES_X * D_RES_Y);

    this.seed();
  }

  setBpm(bpm: number): void { this.bpm = bpm; }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (w !== this.canvas.width)  this.canvas.width = w;
    if (h !== this.canvas.height) this.canvas.height = h;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(0.033, (t - this.lastT) / 1000);
      this.lastT = t;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }
  dispose(): void { this.stop(); this.renderer.dispose(); }

  private seed(): void {
    let placed = 0;
    let attempts = 0;
    const maxAttempts = this.count * 50;
    // Bias chambers ~2× by sampling chambers with finer grid.
    const targets: { x: number; y: number; loop: 0 | 1 }[] = [];
    const step = 1.1;
    for (let y = 1; y < WORLD_Y - 1; y += step) {
      for (let x = 1; x < WORLD_X - 1; x += step) {
        if (this.sdf.sample(x, y) < 0.5) continue;
        const ch = classifyChamber(x, y);
        const lp: 0 | 1 = (ch === 'RA' || ch === 'RV') ? 1 : 0;
        targets.push({ x, y, loop: lp });
      }
    }
    // Chamber-only refill for density bias.
    const fineStep = 0.7;
    for (let y = 1; y < WORLD_Y - 1; y += fineStep) {
      for (let x = 1; x < WORLD_X - 1; x += fineStep) {
        const ch = classifyChamber(x, y);
        if (!ch) continue;
        if (this.sdf.sample(x, y) < 0.5) continue;
        const lp: 0 | 1 = (ch === 'RA' || ch === 'RV') ? 1 : 0;
        targets.push({ x, y, loop: lp });
      }
    }
    // Shuffle.
    for (let i = targets.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    const n = Math.min(this.count, targets.length);
    for (; placed < n; placed++) {
      const t = targets[placed];
      this.pos[placed * 2] = t.x + (Math.random() - 0.5) * 0.6;
      this.pos[placed * 2 + 1] = t.y + (Math.random() - 0.5) * 0.6;
      this.loop[placed] = t.loop;
    }
    // Random-fill if short.
    while (placed < this.count && attempts++ < maxAttempts) {
      const x = Math.random() * WORLD_X;
      const y = Math.random() * WORLD_Y;
      if (this.sdf.sample(x, y) > 0.5) {
        this.pos[placed * 2] = x;
        this.pos[placed * 2 + 1] = y;
        const ch = classifyChamber(x, y);
        this.loop[placed] = (ch === 'RA' || ch === 'RV') ? 1 : 0;
        placed++;
      }
    }
    this.count = placed;
  }

  private rebuildDensity(): void {
    const d = this.density;
    d.fill(0);
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const ix = (this.pos[i * 2]     * D_INV_STEP) | 0;
      const iy = (this.pos[i * 2 + 1] * D_INV_STEP) | 0;
      if (ix < 0 || ix >= D_RES_X || iy < 0 || iy >= D_RES_Y) continue;
      d[iy * D_RES_X + ix] += 1;
    }
  }

  private frame(dt: number): void {
    this.resize();
    this.t += dt;

    const T = 60 / Math.max(20, this.bpm);
    const phi = (this.t % T) / T;
    this.cyclePhi = phi;
    this.phaseLabel = activePhase(phi);

    const bpmK = Math.min(2.6, Math.max(0.5, this.bpm / 70));
    const w = cardiacWeights(phi);

    const t0 = performance.now();
    this.rebuildDensity();
    this.advect(dt, bpmK, w);
    const t1 = performance.now();

    this.renderer.uploadParticles(this.pos, this.vel, this.count);
    this.renderer.draw(this.canvas.width, this.canvas.height, this.count, this.bpm);
    const t2 = performance.now();

    const k = 0.1;
    const inst = dt > 0 ? 1 / dt : 0;
    this.fps = this.fps === 0 ? inst : this.fps + (inst - this.fps) * k;
    this.msSolve = this.msSolve + ((t1 - t0) - this.msSolve) * k;
    this.msRender = this.msRender + ((t2 - t1) - this.msRender) * k;
  }

  private _vRest: [number, number] = [0, 0];
  private _vAtr:  [number, number] = [0, 0];
  private _vEj:   [number, number] = [0, 0];
  private _vFil:  [number, number] = [0, 0];

  private advect(dt: number, bpmK: number, w: { rest: number; atr: number; ej: number; fill: number }): void {
    const n = this.count;
    const pos = this.pos, vel = this.vel;
    const inertia = VEL_INERTIA;
    const sysSpawn = LOOPS.systemic, pulmSpawn = LOOPS.pulmonary;
    const sysR2 = sysSpawn.drainR * sysSpawn.drainR;
    const pulmR2 = pulmSpawn.drainR * pulmSpawn.drainR;
    const spawnSp = 12 + 12 * bpmK;
    const turbAmp = 4 * bpmK;

    for (let i = 0; i < n; i++) {
      const x = pos[i * 2], y = pos[i * 2 + 1];

      // Sample all four modes.
      sampleField(F_REST,     x, y, this._vRest);
      sampleField(F_ATRIAL,   x, y, this._vAtr);
      sampleField(F_EJECTION, x, y, this._vEj);
      sampleField(F_FILLING,  x, y, this._vFil);

      // Blended target velocity, scaled by BPM.
      const tx = (this._vRest[0] * w.rest + this._vAtr[0] * w.atr +
                  this._vEj[0]   * w.ej   + this._vFil[0] * w.fill) * bpmK;
      const ty = (this._vRest[1] * w.rest + this._vAtr[1] * w.atr +
                  this._vEj[1]   * w.ej   + this._vFil[1] * w.fill) * bpmK;

      // Inertia blend toward target.
      let vx = vel[i * 2]     * inertia + tx * (1 - inertia);
      let vy = vel[i * 2 + 1] * inertia + ty * (1 - inertia);

      // Density-gradient separation (cheap pressure relief).
      const ix = (x * D_INV_STEP) | 0, iy = (y * D_INV_STEP) | 0;
      if (ix > 0 && ix < D_RES_X - 1 && iy > 0 && iy < D_RES_Y - 1) {
        const r = iy * D_RES_X + ix;
        const dxg = this.density[r + 1]       - this.density[r - 1];
        const dyg = this.density[r + D_RES_X] - this.density[r - D_RES_X];
        const gl = Math.sqrt(dxg * dxg + dyg * dyg);
        if (gl > 1e-3) {
          const k = SEPARATION_K / gl;
          vx -= dxg * k;
          vy -= dyg * k;
        }
      }

      // Brownian turbulence.
      vx += (Math.random() - 0.5) * turbAmp;
      vy += (Math.random() - 0.5) * turbAmp;

      // Advect.
      let nx = x + vx * dt;
      let ny = y + vy * dt;

      // Boundary: SDF push (hard + soft).
      const sd = this.sdf.sample(nx, ny);
      if (sd < SOFT_REPEL_RANGE) {
        const eps = 0.4;
        let gx = (this.sdf.sample(nx + eps, ny) - this.sdf.sample(nx - eps, ny)) * (0.5 / eps);
        let gy = (this.sdf.sample(nx, ny + eps) - this.sdf.sample(nx, ny - eps)) * (0.5 / eps);
        let gn = Math.sqrt(gx * gx + gy * gy);
        if (gn < 1e-4) {
          gx = WORLD_X * 0.5 - nx;
          gy = WORLD_Y * 0.5 - ny;
          gn = Math.sqrt(gx * gx + gy * gy) || 1;
        }
        const inX = gx / gn, inY = gy / gn;
        if (sd < PARTICLE_R) {
          const push = PARTICLE_R - sd;
          nx += inX * push;
          ny += inY * push;
          // Kill inward-going velocity (bounce-damp).
          const vDotN = vx * inX + vy * inY;
          if (vDotN < 0) { vx -= vDotN * inX; vy -= vDotN * inY; }
        } else {
          const t = (SOFT_REPEL_RANGE - sd) / (SOFT_REPEL_RANGE - PARTICLE_R);
          const push = SOFT_REPEL_K * t * t;
          nx += inX * push;
          ny += inY * push;
        }
      }
      // World clamp.
      if (nx < 0) nx = 0.5; else if (nx > WORLD_X) nx = WORLD_X - 0.5;
      if (ny < 0) ny = 0.5; else if (ny > WORLD_Y) ny = WORLD_Y - 0.5;

      pos[i * 2]     = nx;
      pos[i * 2 + 1] = ny;
      vel[i * 2]     = vx;
      vel[i * 2 + 1] = vy;

      // Loop recycle.
      if (this.loop[i] === 0) {
        const ddx = nx - sysSpawn.drainX, ddy = ny - sysSpawn.drainY;
        if (ddx * ddx + ddy * ddy < sysR2) {
          pos[i * 2]     = sysSpawn.spawnX + (Math.random() - 0.5);
          pos[i * 2 + 1] = sysSpawn.spawnY + (Math.random() - 0.5);
          vel[i * 2]     = sysSpawn.spawnDirX * spawnSp;
          vel[i * 2 + 1] = sysSpawn.spawnDirY * spawnSp;
        }
      } else {
        const pdx = nx - pulmSpawn.drainX, pdy = ny - pulmSpawn.drainY;
        if (pdx * pdx + pdy * pdy < pulmR2) {
          pos[i * 2]     = pulmSpawn.spawnX + (Math.random() - 0.5);
          pos[i * 2 + 1] = pulmSpawn.spawnY + (Math.random() - 0.5);
          vel[i * 2]     = pulmSpawn.spawnDirX * spawnSp;
          vel[i * 2 + 1] = pulmSpawn.spawnDirY * spawnSp;
        }
      }
    }
  }

  getState() {
    return {
      bpm: this.bpm,
      cyclePhi: this.cyclePhi,
      phase: this.phaseLabel,
      particleCount: this.count,
      fps: this.fps,
      msSolve: this.msSolve,
      msRender: this.msRender,
    };
  }
}
