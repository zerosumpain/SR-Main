// Position-Based Fluids (Macklin & Müller, SIGGRAPH 2013) in 2D, plus
// the cardiac cycle controller that drives the flow.
//
// Hot loops are deliberately inlined (no callbacks) to keep the GC quiet.
// The cavity SDF is rasterised into a cached grid per valve-state so each
// per-particle SDF lookup is a bilinear read instead of ~25 primitive evals.

import {
  WORLD,
  WORLD_X,
  WORLD_Y,
  buildCavitySDF,
  classifyChamber,
  CHAMBERS,
  VALVES,
  VESSEL_SEGS,
  LOOPS,
  SMOOTH_K,
  smax,
  type ChamberId,
  type ValveStates,
  type Prim,
  type VesselSeg,
} from './anatomy';

// --- Tunable constants -----------------------------------------------------

const H = 4.0;
const H2 = H * H;
const PARTICLE_R = 0.7;
const REST_DENSITY = 6.5;
const EPS_CFM = 400;
const N_ITER = 2;
const N_SUBSTEPS = 1;
const VISCOSITY = 0.025;     // less smoothing so particles don't clot together
const MAX_SPEED = 80;
const SCORR_K = 0.004;       // stronger anti-clustering pressure
const SCORR_N = 4;
const SCORR_DQ = 0.2 * H;
// Explicit short-range repulsion (independent of PBF pressure model) — keeps
// particles from collapsing into a lump regardless of density tuning.
const REPEL_R = 1.4;         // base distance — multiplied per-particle by comfort
const REPEL_K = 0.12;        // base strength — multiplied per-particle by comfort

const POLY6_C = 4 / (Math.PI * Math.pow(H, 8));
const SPIKY_C = -30 / (Math.PI * Math.pow(H, 5));

const POLY6_W0 = POLY6_C * H2 * H2 * H2; // poly6 at r = 0
const SCORR_W_DQ = (() => {
  const d = H2 - SCORR_DQ * SCORR_DQ;
  return POLY6_C * d * d * d;
})();

// --- SDF cache -------------------------------------------------------------
//
// Rasterise the cavity SDF into a fixed-resolution grid. Bilinear sample
// per particle is ~10 ops vs ~25 primitive closures.

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
      const row = j * SDF_RES_X;
      for (let i = 0; i < SDF_RES_X; i++) {
        const x = (i + 0.5) * SDF_STEP;
        this.data[row + i] = prim(x, y);
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

// --- Wall flex -------------------------------------------------------------
//
// The static SDF defines the resting heart shape. WallFlex modulates the
// effective boundary per-frame so walls feel organic:
//   - cardiac pulsation per chamber (ventricles squeeze in systole, expand
//     in diastole; atria opposite)
//   - pressure-driven outward bulge where particles crowd against a wall
//   - low-amplitude organic noise so edges are never perfectly still
//
// boundary uses: effective_sd(x,y) = baseSdf(x,y) + flex.offset(x,y, ...)

const FLEX_STEP = 1.6;
const FLEX_RES_X = Math.ceil(WORLD_X / FLEX_STEP);
const FLEX_RES_Y = Math.ceil(WORLD_Y / FLEX_STEP);
const FLEX_INV_STEP = 1 / FLEX_STEP;
const FLEX_DECAY = 0.92;
const FLEX_REST_PRESSURE = 4.0;
const FLEX_PRESSURE_GAIN = 0.18;
const FLEX_PRESSURE_MAX = 2.5;
const FLEX_NOISE_AMP = 0.35;
const FLEX_CARDIAC_AMP = 1.6;
// Hard cap on the OUTWARD component of wall-flex. Set below PARTICLE_R so
// that the boundary push always triggers before a particle can exit the
// static cavity. Inward squeeze (negative offsets) is uncapped.
const FLEX_OUT_CAP = 0.55;    // bumped — allows vessel pulse bulge to be visible
// Soft wall-repel zone — engages BEFORE the hard boundary push so particles
// taper away from the wall instead of stacking flush against it.
// Range trimmed to 1.6 (was 2.4) so fewer particles trigger the 4-tap
// SDF gradient sample on each dp iter — single biggest perf win.
const SOFT_REPEL_RANGE = 1.6;
const SOFT_REPEL_K = 0.06;
// Velocity-domain edge cushion — pushes particles away from any wall.
// Wider range than vessel radii so the SDF gradient creates a strong
// centerline-attractor in arteries (push from both walls cancels at the
// midline). Sqrt falloff so force ramps up FAST from the edge of the zone,
// then plateaus near the wall — particles feel the push well before contact.
const EDGE_CUSHION_RANGE = 6.5;
const EDGE_CUSHION_K = 130.0;

class WallFlex {
  pressure: Float32Array;
  chamberMask: Int8Array;

  constructor() {
    this.pressure = new Float32Array(FLEX_RES_X * FLEX_RES_Y);
    this.chamberMask = new Int8Array(FLEX_RES_X * FLEX_RES_Y);
    for (let j = 0; j < FLEX_RES_Y; j++) {
      for (let i = 0; i < FLEX_RES_X; i++) {
        const x = (i + 0.5) * FLEX_STEP;
        const y = (j + 0.5) * FLEX_STEP;
        const ch = classifyChamber(x, y);
        this.chamberMask[j * FLEX_RES_X + i] =
          ch === 'RA' ? 0 : ch === 'RV' ? 1 : ch === 'LA' ? 2 : ch === 'LV' ? 3 : -1;
      }
    }
  }

  rebuild(pos: Float32Array, n: number): void {
    const p = this.pressure;
    for (let i = 0; i < p.length; i++) p[i] *= FLEX_DECAY;
    for (let i = 0; i < n; i++) {
      const ix = (pos[i * 2]     * FLEX_INV_STEP) | 0;
      const iy = (pos[i * 2 + 1] * FLEX_INV_STEP) | 0;
      if (ix < 0 || ix >= FLEX_RES_X || iy < 0 || iy >= FLEX_RES_Y) continue;
      p[iy * FLEX_RES_X + ix] += 1;
    }
  }

  private samplePressure(x: number, y: number): number {
    const fx = x * FLEX_INV_STEP - 0.5;
    const fy = y * FLEX_INV_STEP - 0.5;
    if (fx < 0 || fy < 0 || fx >= FLEX_RES_X - 1 || fy >= FLEX_RES_Y - 1) return 0;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const p = this.pressure;
    const r = iy * FLEX_RES_X + ix;
    const a = p[r], b = p[r + 1], c = p[r + FLEX_RES_X], d = p[r + FLEX_RES_X + 1];
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * ty;
  }

  private chamberAt(x: number, y: number): number {
    const ix = (x * FLEX_INV_STEP) | 0;
    const iy = (y * FLEX_INV_STEP) | 0;
    if (ix < 0 || ix >= FLEX_RES_X || iy < 0 || iy >= FLEX_RES_Y) return -1;
    return this.chamberMask[iy * FLEX_RES_X + ix];
  }

  offset(x: number, y: number, t: number, phase: 'systole' | 'diastole', phaseFrac: number, bpmK: number): number {
    let off = 0;

    // Cardiac chamber pulsation.
    const ch = this.chamberAt(x, y);
    const phaseAmp = 0.5 - 0.5 * Math.cos(Math.PI * 2 * phaseFrac); // 0→1→0
    const inSys = phase === 'systole';
    if (ch === 1 || ch === 3) {            // ventricles
      if (inSys) off -= FLEX_CARDIAC_AMP * phaseAmp * bpmK;
      else       off += FLEX_CARDIAC_AMP * 0.45 * phaseAmp * bpmK;
    } else if (ch === 0 || ch === 2) {     // atria
      if (!inSys) off -= FLEX_CARDIAC_AMP * 0.55 * phaseAmp * bpmK;
      else        off += FLEX_CARDIAC_AMP * 0.35 * phaseAmp * bpmK;
    }

    // Pressure-driven bulge: walls yield outward where particles crowd.
    const p = this.samplePressure(x, y);
    const excess = p - FLEX_REST_PRESSURE;
    if (excess > 0) {
      const bulge = excess * FLEX_PRESSURE_GAIN;
      off += bulge < FLEX_PRESSURE_MAX ? bulge : FLEX_PRESSURE_MAX;
    }

    // Vessel wave-pulse bulge: vessels physically expand where the cardiac
    // pulse is currently travelling through them. Scales quadratically with
    // BPM so high-rate pulses produce noticeably stronger contractions.
    // Capped by FLEX_OUT_CAP downstream so it can never cause leakage.
    const wb = pathWaveBulgeAt(x, y, bpmK);
    if (wb > 0) off += wb * 0.9 * bpmK * bpmK;

    // Organic noise — sum of a few sinusoids, time-varying.
    const tp = t * 0.7;
    off += FLEX_NOISE_AMP * (
      Math.sin(x * 0.18 + y * 0.13 + tp) *
      Math.cos(y * 0.16 - x * 0.11 + tp * 1.1)
    );

    return off;
  }
}

// --- Solver ----------------------------------------------------------------

export interface SolverOpts {
  count: number;
  // Constraint iterations per substep. Lower = ~50% solver cost per drop.
  // Trades density-resolution stability for speed; with explicit short-range
  // repel + soft-repel, iterations=1 is usually fine.
  iterations?: number;
  // Viscosity coefficient. 0 disables the viscosity neighbour loop entirely
  // (a full third pass over neighbours).
  viscosity?: number;
}

export class FluidSolver {
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  lambda: Float32Array;
  density: Float32Array;
  chamber: Int8Array;
  loop: Int8Array;
  // Per-particle "comfort" multiplier — varies repulsion range/strength so
  // particles aren't all packed at the same distance. Set once at seed time.
  comfort: Float32Array;

  private cellSize = H;
  private cols: number;
  private rows: number;
  private cellHead: Int32Array;
  private cellNext: Int32Array;

  // SDF cache, keyed by 4-bit valve-state code.
  private sdfCache = new Map<number, SDFGrid>();
  private sdf: SDFGrid;

  count: number;

  constructor(opts: SolverOpts) {
    this.count = opts.count;
    this.capacity = opts.count;
    if (opts.iterations !== undefined) this.iterations = opts.iterations;
    if (opts.viscosity !== undefined) this.viscosity = opts.viscosity;
    const n = opts.count;
    this.pos = new Float32Array(n * 2);
    this.prev = new Float32Array(n * 2);
    this.vel = new Float32Array(n * 2);
    this.lambda = new Float32Array(n);
    this.density = new Float32Array(n);
    this.chamber = new Int8Array(n);
    this.loop = new Int8Array(n);
    this.comfort = new Float32Array(n);

    this.cols = Math.ceil(WORLD_X / this.cellSize) + 2;
    this.rows = Math.ceil(WORLD_Y / this.cellSize) + 2;
    this.cellHead = new Int32Array(this.cols * this.rows);
    this.cellNext = new Int32Array(n);

    // Pre-build both common valve configurations so first frame doesn't stall.
    this.sdf = this.getSdf({ tricuspid: true, mitral: true, pulmonary: true, aortic: true });
    this.getSdf({ tricuspid: false, mitral: false, pulmonary: true, aortic: true });
    this.getSdf({ tricuspid: true, mitral: true, pulmonary: false, aortic: false });

    this.seedParticles();
  }

  private valveKey(s: ValveStates): number {
    return (+s.tricuspid) | (+s.mitral << 1) | (+s.pulmonary << 2) | (+s.aortic << 3);
  }

  private getSdf(s: ValveStates): SDFGrid {
    const k = this.valveKey(s);
    let g = this.sdfCache.get(k);
    if (!g) {
      g = new SDFGrid(buildCavitySDF(s));
      this.sdfCache.set(k, g);
    }
    return g;
  }

  setValveStates(s: ValveStates): void {
    this.sdf = this.getSdf(s);
  }

  // Adjust how many particles the solver actually iterates over without
  // reallocating storage. Used by the FPS watchdog for live perf scaling.
  setActiveCount(n: number): void {
    if (n < 0) n = 0;
    if (n > this.capacity) n = this.capacity;
    this.count = n;
  }

  // Seed particles with a 2/3 ventricle bias.
  //   - Ventricular pool (RV+LV): 66% of total
  //   - Everything else (atria + arteries): 34%
  // Particles spawn in the lower chambers and are destroyed at the top of
  // the arteries (see handleLoops). The bias here matches the steady-state
  // target so the sim doesn't have to ramp up.
  private seedParticles(): void {
    type Cand = { x: number; y: number; loop: 0 | 1 };
    const ventCands: Cand[] = [];
    const otherCands: Cand[] = [];
    const probe = this.sdfCache.values().next().value!;

    const sweep = (step: number, jitter: number, ventricleOnly: boolean): void => {
      for (let y = 1; y < WORLD_Y - 1; y += step) {
        for (let x = 1; x < WORLD_X - 1; x += step) {
          const xj = x + (Math.random() - 0.5) * jitter;
          const yj = y + (Math.random() - 0.5) * jitter;
          if (probe.sample(xj, yj) < 0.5) continue;
          const ch = classifyChamber(xj, yj);
          const isVent = ch === 'RV' || ch === 'LV';
          if (ventricleOnly && !isVent) continue;
          let loop: 0 | 1;
          if (ch) loop = (ch === 'RA' || ch === 'RV') ? 1 : 0;
          else    loop = nearestVesselLoop(xj, yj);
          (isVent ? ventCands : otherCands).push({ x: xj, y: yj, loop });
        }
      }
    };
    // Coarse pass over everything.
    sweep(1.0, 0.4, false);
    // Extra ventricle-only passes to push the ventricle pool well above 66%
    // of available candidates (we'll trim to the exact ratio below).
    sweep(0.6, 0.3, true);
    sweep(0.5, 0.25, true);

    const shuffle = <T,>(arr: T[]): void => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };
    shuffle(ventCands);
    shuffle(otherCands);

    const total = Math.min(this.count, ventCands.length + otherCands.length);
    const wantVent = Math.min(ventCands.length, Math.floor(total * 0.66));
    const wantOther = Math.min(otherCands.length, total - wantVent);

    let i = 0;
    for (let k = 0; k < wantVent; k++, i++) {
      this.pos[i * 2] = ventCands[k].x;
      this.pos[i * 2 + 1] = ventCands[k].y;
      this.loop[i] = ventCands[k].loop;
      this.comfort[i] = 0.55 + Math.random() * 0.95;
    }
    for (let k = 0; k < wantOther; k++, i++) {
      this.pos[i * 2] = otherCands[k].x;
      this.pos[i * 2 + 1] = otherCands[k].y;
      this.loop[i] = otherCands[k].loop;
      this.comfort[i] = 0.55 + Math.random() * 0.95;
    }
    this.count = i;
  }

  private rebuildHash(): void {
    const head = this.cellHead, next = this.cellNext;
    const cs = this.cellSize, cols = this.cols, rows = this.rows;
    head.fill(-1);
    const prev = this.prev;
    for (let i = 0; i < this.count; i++) {
      const cx = ((prev[i * 2] / cs) | 0) + 1;
      const cy = ((prev[i * 2 + 1] / cs) | 0) + 1;
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) {
        next[i] = -1;
        continue;
      }
      const idx = cy * cols + cx;
      next[i] = head[idx];
      head[idx] = i;
    }
  }

  step(dt: number, applyExternal: (i: number, fxOut: Float32Array) => void): void {
    const n = this.count;
    const pos = this.pos, prev = this.prev, vel = this.vel;
    const lambda = this.lambda;
    const sdf = this.sdf;
    const flex = this.flex;
    const fT = this.simTime, fPhase = this.cardiacPhase, fFrac = this.cardiacPhaseFrac, fBpm = this.bpmK;

    // Throttle slow-updating work to every 3rd step. Post-increment so the
    // first step is `doSlow=true` (avoids stale chamber data on startup).
    const doSlow = (this._throttle++ % 3) === 0;
    if (doSlow) flex.rebuild(pos, n);

    // Advance vessel-wave timers for this substep.
    tickPaths(dt);

    // External forces + predicted positions.
    const f = this._fScratch;
    for (let i = 0; i < n; i++) {
      f[0] = 0; f[1] = 0;
      applyExternal(i, f);

      // Wide-range edge cushion — pushes particles away from any nearby
      // wall, applied as a velocity-domain force once per step. Creates the
      // visible inset margin around chambers and arteries.
      const px0 = pos[i * 2], py0 = pos[i * 2 + 1];
      const sd0 = sdf.sample(px0, py0);
      if (sd0 > 0 && sd0 < EDGE_CUSHION_RANGE) {
        const eps = 0.4;
        const gx = (sdf.sample(px0 + eps, py0) - sdf.sample(px0 - eps, py0)) * (0.5 / eps);
        const gy = (sdf.sample(px0, py0 + eps) - sdf.sample(px0, py0 - eps)) * (0.5 / eps);
        const gl = Math.sqrt(gx * gx + gy * gy);
        if (gl > 1e-4) {
          // sqrt falloff: kicks in sharply when entering the zone, so
          // particles never get the chance to drift right up to the wall.
          const t = 1 - sd0 / EDGE_CUSHION_RANGE;
          const k = (EDGE_CUSHION_K * Math.sqrt(t)) / gl;
          f[0] += gx * k;
          f[1] += gy * k;
        }
      }

      let vx = vel[i * 2]     + f[0] * dt;
      let vy = vel[i * 2 + 1] + f[1] * dt;
      const sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > MAX_SPEED) { const k = MAX_SPEED / sp; vx *= k; vy *= k; }
      vel[i * 2] = vx; vel[i * 2 + 1] = vy;
      prev[i * 2]     = pos[i * 2]     + vx * dt;
      prev[i * 2 + 1] = pos[i * 2 + 1] + vy * dt;
    }

    const head = this.cellHead, next = this.cellNext;
    const cs = this.cellSize, cols = this.cols, rows = this.rows;

    const iterCount = this.iterations;
    for (let iter = 0; iter < iterCount; iter++) {
      const isLastIter = iter === iterCount - 1;
      this.rebuildHash();

      // ---- density + lambda (inlined neighbour walk) ----
      for (let i = 0; i < n; i++) {
        const px = prev[i * 2], py = prev[i * 2 + 1];
        const cxB = (px / cs) | 0, cyB = (py / cs) | 0;
        let rho = POLY6_W0;
        let sumGrad2 = 0;
        let gix = 0, giy = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = cyB + oy + 1;
          if (cy < 0 || cy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const cx = cxB + ox + 1;
            if (cx < 0 || cx >= cols) continue;
            let j = head[cy * cols + cx];
            while (j !== -1) {
              if (j !== i) {
                const dx = px - prev[j * 2];
                const dy = py - prev[j * 2 + 1];
                const r2 = dx * dx + dy * dy;
                if (r2 < H2) {
                  const d = H2 - r2;
                  rho += POLY6_C * d * d * d;
                  if (r2 > 1e-12) {
                    const r = Math.sqrt(r2);
                    const dh = H - r;
                    const gm = (SPIKY_C * dh * dh) / REST_DENSITY;
                    const inv = 1 / r;
                    const gxj = gm * dx * inv;
                    const gyj = gm * dy * inv;
                    sumGrad2 += gxj * gxj + gyj * gyj;
                    gix -= gxj;
                    giy -= gyj;
                  }
                }
              }
              j = next[j];
            }
          }
        }
        sumGrad2 += gix * gix + giy * giy;
        this.density[i] = rho;
        // Per-particle target density: chambers tolerate 1.35× the rest
        // density so blood still pools there, but without exploding the
        // local neighbour count (was 1.7×, hot path got hammered).
        const restMul = this.chamber[i] >= 0 ? 1.35 : 1.0;
        const C = Math.max(0, rho / (REST_DENSITY * restMul) - 1);
        lambda[i] = -C / (sumGrad2 + EPS_CFM);
      }

      // ---- position deltas + boundary (inlined) ----
      const comfort = this.comfort;
      const chamberArr = this.chamber;
      for (let i = 0; i < n; i++) {
        const px = prev[i * 2], py = prev[i * 2 + 1];
        const cxB = (px / cs) | 0, cyB = (py / cs) | 0;
        const li = lambda[i];
        // Chamber particles: dampened comfort so they pack closer (was 0.55,
        // raised to 0.78 to thin chamber neighbour counts).
        const ci = comfort[i] * (chamberArr[i] >= 0 ? 0.78 : 1.0);
        // Per-particle repulsion params — pairs use the larger of the two
        // comfort values so a "high comfort" particle pushes harder.
        let dxAcc = 0, dyAcc = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = cyB + oy + 1;
          if (cy < 0 || cy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const cx = cxB + ox + 1;
            if (cx < 0 || cx >= cols) continue;
            let j = head[cy * cols + cx];
            while (j !== -1) {
              if (j !== i) {
                const dx = px - prev[j * 2];
                const dy = py - prev[j * 2 + 1];
                const r2 = dx * dx + dy * dy;
                if (r2 < H2 && r2 > 1e-12) {
                  const r = Math.sqrt(r2);
                  const dh = H - r;
                  const gm = SPIKY_C * dh * dh;
                  const d6 = H2 - r2;
                  const w = POLY6_C * d6 * d6 * d6;
                  const wRatio = w / SCORR_W_DQ;
                  const sCorr = -SCORR_K * Math.pow(wRatio, SCORR_N);
                  const coeff = (li + lambda[j] + sCorr) / REST_DENSITY;
                  const inv = 1 / r;
                  dxAcc += coeff * gm * dx * inv;
                  dyAcc += coeff * gm * dy * inv;
                  // Per-particle repulsion: the bigger comfort value of the
                  // two particles dictates the personal-space radius.
                  // Skipping the per-neighbour chamber lookup — `ci` is
                  // already chamber-modulated and that's enough variation.
                  const cj = comfort[j];
                  const cMax = ci > cj ? ci : cj;
                  const myR = REPEL_R * cMax;
                  if (r < myR) {
                    const overlap = myR - r;
                    const push = REPEL_K * cMax * overlap * overlap * inv;
                    dxAcc += dx * push;
                    dyAcc += dy * push;
                  }
                }
              }
              j = next[j];
            }
          }
        }
        let nx = px + dxAcc;
        let ny = py + dyAcc;

        // Boundary check.
        // Early iters: use cheap static SDF + hard-only push.
        // Last iter:   use full flex-aware SDF + soft + hard push.
        // The early hard push prevents penetration; the last-iter soft
        // push gives the wall its organic taper. We save 1 flex eval and
        // up to 4 SDF samples per particle on every iter except the last.
        const baseSd = sdf.sample(nx, ny);
        let sd: number;
        let needBoundary = false;
        let useSoft = false;
        if (isLastIter) {
          let off = flex.offset(nx, ny, fT, fPhase, fFrac, fBpm);
          if (off > FLEX_OUT_CAP) off = FLEX_OUT_CAP;
          sd = baseSd + off;
          if (sd < SOFT_REPEL_RANGE) { needBoundary = true; useSoft = sd >= PARTICLE_R; }
        } else {
          sd = baseSd;
          if (sd < PARTICLE_R) needBoundary = true;
        }
        if (needBoundary) {
          const eps = 0.4;
          let gx = (sdf.sample(nx + eps, ny) - sdf.sample(nx - eps, ny)) * (0.5 / eps);
          let gy = (sdf.sample(nx, ny + eps) - sdf.sample(nx, ny - eps)) * (0.5 / eps);
          let gl = Math.sqrt(gx * gx + gy * gy);
          if (gl < 1e-4) {
            gx = (WORLD_X * 0.5 - nx);
            gy = (WORLD_Y * 0.5 - ny);
            gl = Math.sqrt(gx * gx + gy * gy) || 1;
          }
          const inX = gx / gl, inY = gy / gl;
          if (useSoft) {
            const t = (SOFT_REPEL_RANGE - sd) / (SOFT_REPEL_RANGE - PARTICLE_R);
            const softPush = SOFT_REPEL_K * t * t;
            nx += inX * softPush;
            ny += inY * softPush;
          } else {
            const push = PARTICLE_R - sd;
            nx += inX * push;
            ny += inY * push;
          }
        }
        // Hard world-bounds clamp — last-resort safety net so nothing ever
        // renders outside the page.
        if (nx < 0)        nx = 0.5;
        else if (nx > WORLD_X) nx = WORLD_X - 0.5;
        if (ny < 0)        ny = 0.5;
        else if (ny > WORLD_Y) ny = WORLD_Y - 0.5;
        prev[i * 2] = nx;
        prev[i * 2 + 1] = ny;
      }
    }

    const invDt = 1 / dt;
    for (let i = 0; i < n; i++) {
      vel[i * 2]     = (prev[i * 2]     - pos[i * 2])     * invDt;
      vel[i * 2 + 1] = (prev[i * 2 + 1] - pos[i * 2 + 1]) * invDt;
    }

    // XSPH viscosity (inlined neighbour walk). Disabled when viscosity===0.
    const visc = this.viscosity;
    if (visc > 0) {
      const velSnap = this._velSnap ??= new Float32Array(n * 2);
      if (velSnap.length < n * 2) { /* never resize down */ }
      for (let i = 0; i < n * 2; i++) velSnap[i] = vel[i];
      for (let i = 0; i < n; i++) {
        const px = prev[i * 2], py = prev[i * 2 + 1];
        const cxB = (px / cs) | 0, cyB = (py / cs) | 0;
        let vxAcc = 0, vyAcc = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const cy = cyB + oy + 1;
          if (cy < 0 || cy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const cx = cxB + ox + 1;
            if (cx < 0 || cx >= cols) continue;
            let j = head[cy * cols + cx];
            while (j !== -1) {
              if (j !== i) {
                const dx = px - prev[j * 2];
                const dy = py - prev[j * 2 + 1];
                const r2 = dx * dx + dy * dy;
                if (r2 < H2) {
                  const d = H2 - r2;
                  const w = POLY6_C * d * d * d;
                  vxAcc += (velSnap[j * 2]     - velSnap[i * 2])     * w;
                  vyAcc += (velSnap[j * 2 + 1] - velSnap[i * 2 + 1]) * w;
                }
              }
              j = next[j];
            }
          }
        }
        vel[i * 2]     += visc * vxAcc;
        vel[i * 2 + 1] += visc * vyAcc;
      }
    }

    for (let i = 0; i < n; i++) {
      pos[i * 2]     = prev[i * 2];
      pos[i * 2 + 1] = prev[i * 2 + 1];
    }

    // Chamber classification — particles don't switch chambers fast enough
    // to need this every step. Throttle to every 3rd step.
    if (doSlow) {
      for (let i = 0; i < n; i++) {
        const ch = classifyChamber(pos[i * 2], pos[i * 2 + 1]);
        this.chamber[i] = ch === 'RA' ? 0 : ch === 'RV' ? 1 : ch === 'LA' ? 2 : ch === 'LV' ? 3 : -1;
      }
    }

    this.handleLoops();
  }

  private _fScratch = new Float32Array(2);
  private _velSnap?: Float32Array;

  // BPM gets piped in here so re-spawned particles enter the loop with a
  // velocity that scales with heart rate.
  spawnSpeed = 12;

  // Throttle counter — used to skip work that doesn't need to update every step.
  private _throttle = 0;
  // Per-instance overrides of the file-level constants.
  iterations: number = N_ITER;
  viscosity: number = VISCOSITY;
  // Maximum capacity (allocated). Active `count` may be ≤ this for adaptive scaling.
  readonly capacity: number;

  // Cardiac context — set per frame from outside, used by wall-flex.
  simTime = 0;
  cardiacPhase: 'systole' | 'diastole' = 'diastole';
  cardiacPhaseFrac = 0;
  bpmK = 1;
  flex = new WallFlex();

  private handleLoops(): void {
    const sys = LOOPS.systemic;
    const pulm = LOOPS.pulmonary;
    const pos = this.pos, vel = this.vel, loop = this.loop;
    const sysR2 = sys.drainR * sys.drainR;
    const pulmR2 = pulm.drainR * pulm.drainR;
    // Jitter radius for the respawn — particles enter the ventricle as a
    // small cloud around the centre, not stacked on a point.
    const SPAWN_JITTER = 5.0;
    for (let i = 0; i < this.count; i++) {
      const x = pos[i * 2], y = pos[i * 2 + 1];
      if (loop[i] === 0) {
        const ddx = x - sys.drainX, ddy = y - sys.drainY;
        if (ddx * ddx + ddy * ddy < sysR2) {
          pos[i * 2]     = sys.spawnX + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
          pos[i * 2 + 1] = sys.spawnY + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
          vel[i * 2]     = 0;
          vel[i * 2 + 1] = 0;
        }
      } else {
        const pdx = x - pulm.drainX, pdy = y - pulm.drainY;
        if (pdx * pdx + pdy * pdy < pulmR2) {
          pos[i * 2]     = pulm.spawnX + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
          pos[i * 2 + 1] = pulm.spawnY + (Math.random() - 0.5) * 2 * SPAWN_JITTER;
          vel[i * 2]     = 0;
          vel[i * 2 + 1] = 0;
        }
      }
    }
  }
}

// --- Cardiac controller ----------------------------------------------------

export type Phase = 'systole' | 'diastole';

export interface CardiacState {
  bpm: number;
  t: number;
  phase: Phase;
  phaseFrac: number;
  valves: ValveStates;
}

export function makeCardiacState(bpm: number): CardiacState {
  return {
    bpm,
    t: 0,
    phase: 'diastole',
    phaseFrac: 0,
    valves: { tricuspid: true, mitral: true, pulmonary: false, aortic: false },
  };
}

const SYSTOLE_FRAC = 0.35;

export function tickCardiac(state: CardiacState, dt: number): void {
  state.t += dt;
  const T = 60 / Math.max(20, state.bpm);
  const phi = (state.t % T) / T;
  if (phi < SYSTOLE_FRAC) {
    state.phase = 'systole';
    state.phaseFrac = phi / SYSTOLE_FRAC;
    state.valves.tricuspid = false;
    state.valves.mitral = false;
    state.valves.pulmonary = true;
    state.valves.aortic = true;
  } else {
    state.phase = 'diastole';
    state.phaseFrac = (phi - SYSTOLE_FRAC) / (1 - SYSTOLE_FRAC);
    state.valves.tricuspid = true;
    state.valves.mitral = true;
    state.valves.pulmonary = false;
    state.valves.aortic = false;
  }
}

// --- Vessel pump as wave-carrying paths ---------------------------------
//
// Each vessel is a "path" — one or more connected segments with a cumulative
// arc-length parameter `s ∈ [0, totalLen]` from the origin (chamber side) to
// the drain (page edge). Each path carries:
//   - a continuous baseline flow (slow background drift)
//   - an optional wave that's TRIGGERED by a cardiac event and propagates
//     along the path at finite speed
//
// The wave is a Gaussian pulse centred on `waveFront = waveTime * waveSpeed`.
// It decays exponentially after spawn, so each heartbeat sends ONE pulse
// down each artery — exactly what a real systolic pulse looks like in
// the aorta and pulmonary trunk.

interface PathSeg {
  ax: number; ay: number; bx: number; by: number; r: number;
  bax: number; bay: number; len2: number; segLen: number;
  dirX: number; dirY: number;
  sStart: number;
}

interface VPath {
  loop: 0 | 1;
  trigger: 'systole' | 'continuous';
  baseAmp: number;     // slow continuous push (units/s² of acceleration)
  pulseAmp: number;    // peak amplitude of the propagating wave
  totalLen: number;
  segs: PathSeg[];
  waveTime: number;    // seconds since the most recent wave was spawned
}

function makeSeg(ax: number, ay: number, bx: number, by: number, r: number, sStart: number): PathSeg {
  const bax = bx - ax, bay = by - ay;
  const segLen = Math.sqrt(bax * bax + bay * bay) || 1;
  return {
    ax, ay, bx, by, r, bax, bay,
    len2: segLen * segLen, segLen, sStart,
    dirX: bax / segLen, dirY: bay / segLen,
  };
}

function buildPath(
  segs: [number, number, number, number, number][],
  loop: 0 | 1,
  trigger: 'systole' | 'continuous',
  baseAmp: number,
  pulseAmp: number,
): VPath {
  let s = 0;
  const built: PathSeg[] = [];
  for (const [ax, ay, bx, by, r] of segs) {
    const seg = makeSeg(ax, ay, bx, by, r, s);
    built.push(seg);
    s += seg.segLen;
  }
  return { loop, trigger, baseAmp, pulseAmp, totalLen: s, segs: built, waveTime: 999 };
}

const PATHS: VPath[] = [
  // Aorta — strong continuous outflow plus a big systolic surge. The
  // baseline alone is enough to keep particles streaming OUT of the bell;
  // the pulse adds the visible BPM-driven beat.
  buildPath([
    [58, 50,  58, 100, 3.0],
    [58, 100, 58, 130, 5.5],
  ], 0, 'systole', 70, 520),
  // Pulmonary trunk — same architecture, slightly weaker (RV pressure
  // is ~1/5 of LV in real anatomy but we want both visible).
  buildPath([
    [35, 50,  35, 100, 2.8],
    [35, 100, 35, 130, 5.5],
  ], 1, 'systole', 55, 420),
  // Pulmonary vein — strong continuous return into LA so spawned
  // particles immediately flow down out of the spawn zone.
  buildPath([
    [82, 130, 66, 100, 5.5],
    [66, 100, 64, 88,  2.6],
  ], 0, 'continuous', 60, 0),
  // SVC — strong continuous return into RA.
  buildPath([
    [18, 130, 34, 100, 5.5],
    [34, 100, 30, 88,  2.6],
  ], 1, 'continuous', 60, 0),
];

const WAVE_SPEED_BASE = 180;   // world units / sec at bpm = 70
const WAVE_WIDTH = 28;          // arc-length spread (wider — pulse "fills" the artery more)
const WAVE_LIFETIME = 2.0;      // wave persists across most of a heartbeat at 70 bpm

function nearestVesselLoop(x: number, y: number): 0 | 1 {
  let bestD2 = Infinity;
  let best: 0 | 1 = 0;
  for (let p = 0; p < PATHS.length; p++) {
    const path = PATHS[p];
    for (let i = 0; i < path.segs.length; i++) {
      const v = path.segs[i];
      const pax = x - v.ax, pay = y - v.ay;
      let h = (pax * v.bax + pay * v.bay) / v.len2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = pax - v.bax * h, dy = pay - v.bay * h;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = path.loop; }
    }
  }
  return best;
}

// Per-particle force from the path the particle is inside (if any).
// `bpmK` scales baseline + wave amplitude; `waveSpeed` scales how fast the
// pulse propagates (also bpm-driven).
export function pathPump(x: number, y: number, fOut: Float32Array, bpmK: number, waveSpeed: number): void {
  for (let p = 0; p < PATHS.length; p++) {
    const path = PATHS[p];
    for (let i = 0; i < path.segs.length; i++) {
      const seg = path.segs[i];
      const pax = x - seg.ax, pay = y - seg.ay;
      const h = (pax * seg.bax + pay * seg.bay) / seg.len2;
      if (h < 0 || h > 1) continue;
      const dx = pax - seg.bax * h, dy = pay - seg.bay * h;
      const d2 = dx * dx + dy * dy;
      if (d2 < seg.r * seg.r) {
        const s = seg.sStart + h * seg.segLen;
        let amp = path.baseAmp * bpmK;
        if (path.pulseAmp > 0 && path.waveTime < WAVE_LIFETIME) {
          const wf = path.waveTime * waveSpeed;
          const ds = (s - wf) / WAVE_WIDTH;
          const decay = 1 - path.waveTime / WAVE_LIFETIME;
          amp += path.pulseAmp * bpmK * bpmK * Math.exp(-ds * ds) * decay;
        }
        fOut[0] += seg.dirX * amp;
        fOut[1] += seg.dirY * amp;
        return; // single-path attribution
      }
    }
  }
}

// Advance every wave's elapsed time. Called once per substep.
// --- Dynamic fade mask ----------------------------------------------------
//
// The static fade mask in anatomy.ts gives a fixed soft silhouette. The
// dynamic one is rebuilt on a throttle so vessel walls visibly expand
// where the cardiac wave is currently passing — particles render through
// the bulged area while the surrounding wall stays sharp.

const DYN_FADE_RES_X = 256;
const DYN_FADE_RES_Y = 320;
const DYN_FADE_STEP_X = WORLD_X / DYN_FADE_RES_X;
const DYN_FADE_STEP_Y = WORLD_Y / DYN_FADE_RES_Y;
const DYN_FADE_RANGE = 3.0;

let _staticFadeBase: Float32Array | null = null;
let _dynFadeBuf: Uint8Array | null = null;

function ensureStaticFadeBase(): void {
  if (_staticFadeBase) return;
  const sdf = buildCavitySDF({ tricuspid: true, mitral: true, pulmonary: true, aortic: true });
  _staticFadeBase = new Float32Array(DYN_FADE_RES_X * DYN_FADE_RES_Y);
  for (let j = 0; j < DYN_FADE_RES_Y; j++) {
    const y = (j + 0.5) * DYN_FADE_STEP_Y;
    const row = j * DYN_FADE_RES_X;
    for (let i = 0; i < DYN_FADE_RES_X; i++) {
      _staticFadeBase[row + i] = sdf((i + 0.5) * DYN_FADE_STEP_X, y);
    }
  }
}

export function buildDynamicFadeMask(bpmK: number): { data: Uint8Array; width: number; height: number } {
  ensureStaticFadeBase();
  const base = _staticFadeBase!;
  if (!_dynFadeBuf) _dynFadeBuf = new Uint8Array(DYN_FADE_RES_X * DYN_FADE_RES_Y);
  const out = _dynFadeBuf;
  const inv = 1 / DYN_FADE_RANGE;
  // Bulge gain — quadratic in BPM so high heart rates get dramatic vessel pulsing.
  const bulgeGain = 1.6 * bpmK * bpmK;
  for (let j = 0; j < DYN_FADE_RES_Y; j++) {
    const y = (j + 0.5) * DYN_FADE_STEP_Y;
    const row = j * DYN_FADE_RES_X;
    for (let i = 0; i < DYN_FADE_RES_X; i++) {
      const x = (i + 0.5) * DYN_FADE_STEP_X;
      let sd = base[row + i];
      const wb = pathWaveBulgeAt(x, y, bpmK);
      if (wb > 0) sd += wb * bulgeGain;
      let t = sd * inv;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      // smoothstep
      const s = t * t * (3 - 2 * t);
      out[row + i] = (s * 255) | 0;
    }
  }
  return { data: out, width: DYN_FADE_RES_X, height: DYN_FADE_RES_Y };
}

// Bulge magnitude at a point — non-zero only when a cardiac pulse wave is
// currently passing through a vessel that contains this point. Used by
// WallFlex.offset to make vessel walls visibly contract/expand with the
// pulse. Returns 0..1 (the wave's local intensity).
function pathWaveBulgeAt(x: number, y: number, bpmK: number): number {
  const waveSpeed = WAVE_SPEED_BASE * bpmK;
  let bestBulge = 0;
  for (let p = 0; p < PATHS.length; p++) {
    const path = PATHS[p];
    if (path.pulseAmp <= 0) continue;
    if (path.waveTime >= WAVE_LIFETIME) continue;
    const wf = path.waveTime * waveSpeed;
    for (let i = 0; i < path.segs.length; i++) {
      const seg = path.segs[i];
      const pax = x - seg.ax, pay = y - seg.ay;
      const h = (pax * seg.bax + pay * seg.bay) / seg.len2;
      if (h < 0 || h > 1) continue;
      const dx = pax - seg.bax * h, dy = pay - seg.bay * h;
      const d2 = dx * dx + dy * dy;
      const r = seg.r + 1.5;
      if (d2 > r * r) continue;
      const s = seg.sStart + h * seg.segLen;
      const ds = (s - wf) / WAVE_WIDTH;
      const decay = 1 - path.waveTime / WAVE_LIFETIME;
      const intensity = Math.exp(-ds * ds) * decay;
      if (intensity > bestBulge) bestBulge = intensity;
    }
  }
  return bestBulge;
}

function tickPaths(dt: number): void {
  for (let i = 0; i < PATHS.length; i++) {
    PATHS[i].waveTime += dt;
  }
}

// Spawn a new wave at the origin of every systolic-triggered path. Called
// from outside on the diastole→systole transition.
export function triggerSystoleWaves(): void {
  for (let i = 0; i < PATHS.length; i++) {
    if (PATHS[i].trigger === 'systole') PATHS[i].waveTime = 0;
  }
}

const SVC = { x: 28, y: 110, dx: 0.3,  dy: -1 };
const IVC = { x: 28, y: 110, dx: 0.3,  dy: -1 };  // merged with SVC in tight layout
const PV1 = { x: 76, y: 110, dx: -0.4, dy: -1 };
const PV2 = { x: 76, y: 110, dx: -0.4, dy: -1 };

export function makeCardiacForce(solver: FluidSolver, state: CardiacState, bpm: () => number) {
  return (i: number, fOut: Float32Array) => {
    const x = solver.pos[i * 2], y = solver.pos[i * 2 + 1];
    const ch = solver.chamber[i];
    const ci = solver.comfort[i];
    // BPM scales linearly for inflow, quadratically for ejection — sprint
    // BPM should feel dramatically more energetic, not just faster cycling.
    const r = Math.min(2.6, Math.max(0.5, bpm() / 70));
    const linK = r;
    const quadK = r * r;
    const phaseAmp = 0.5 + 0.5 * Math.sin(Math.PI * state.phaseFrac);

    // Per-particle turbulence kick — small random perturbation that breaks
    // up uniform laminar flow. Stronger at higher BPM and in more "active"
    // particles. This is the dominant source of swirly motion in chambers.
    const turb = 9 * linK * ci;
    fOut[0] += (Math.random() - 0.5) * turb;
    fOut[1] += (Math.random() - 0.5) * turb;

    // Vessel pumping is now driven by cardiac-triggered pressure waves
    // (see PATHS / pathPump). The wave speed scales with BPM so the pulse
    // travels down the aorta faster at higher heart rates.
    pathPump(x, y, fOut, linK, WAVE_SPEED_BASE * linK);

    // Cavity pumps 3× baseline (200% stronger) for dramatic systole.
    if (state.phase === 'systole') {
      if (ch === 1) {
        const v = VALVES.pulmonary;
        pushToward(x, y, v.ax, v.ay, fOut, 540 * quadK * phaseAmp);
        contract(CHAMBER_C.RV, x, y, fOut, 270 * quadK * phaseAmp);
      } else if (ch === 3) {
        const v = VALVES.aortic;
        pushToward(x, y, v.ax, v.ay, fOut, 600 * quadK * phaseAmp);
        contract(CHAMBER_C.LV, x, y, fOut, 300 * quadK * phaseAmp);
      }
    } else {
      if (ch === 0) {
        pushToward(x, y, VALVES.tricuspid.ax, VALVES.tricuspid.ay, fOut, 225 * quadK * phaseAmp);
        contract(CHAMBER_C.RA, x, y, fOut, 135 * quadK * phaseAmp);
      } else if (ch === 2) {
        pushToward(x, y, VALVES.mitral.ax, VALVES.mitral.ay, fOut, 240 * quadK * phaseAmp);
        contract(CHAMBER_C.LA, x, y, fOut, 135 * quadK * phaseAmp);
      }
    }
  };
}

function inflow(src: { x: number; y: number; dx: number; dy: number }, x: number, y: number, fOut: Float32Array, mag: number): void {
  const dx = x - src.x, dy = y - src.y;
  if (dx * dx + dy * dy > 64) return;
  fOut[0] += src.dx * mag;
  fOut[1] += src.dy * mag;
}

export function pushToward(x: number, y: number, tx: number, ty: number, fOut: Float32Array, mag: number): void {
  const dx = tx - x, dy = ty - y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  fOut[0] += (dx / len) * mag;
  fOut[1] += (dy / len) * mag;
}

export function contract(c: { x: number; y: number }, x: number, y: number, fOut: Float32Array, mag: number): void {
  const dx = c.x - x, dy = c.y - y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const factor = Math.min(1, len / 6);
  fOut[0] += (dx / len) * mag * factor;
  fOut[1] += (dy / len) * mag * factor;
}

export const CHAMBER_C: Record<ChamberId, { x: number; y: number }> = {
  RA: { x: 38.0, y: 84.0 },
  RV: { x: 38.0, y: 43.0 },
  LA: { x: 60.0, y: 84.0 },
  LV: { x: 65.0, y: 36.0 },
};

export const SOLVER_CONSTS = {
  N_SUBSTEPS,
  PARTICLE_R,
  WORLD,
  WORLD_X,
  WORLD_Y,
  SMOOTH_K,
  smax,
};
