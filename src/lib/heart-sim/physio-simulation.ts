// Drop-in alternative to HeartSimulation that uses the physiologically
// accurate 6-phase cardiac controller. Reuses the same PBF FluidSolver
// and ParticleRenderer; only the cardiac timing/forces differ.

import { ParticleRenderer } from './renderer';
import {
  FluidSolver,
  triggerSystoleWaves,
  buildDynamicFadeMask,
  SOLVER_CONSTS,
} from './solver';
import {
  makePhysioCardiacState,
  tickPhysioCardiac,
  makePhysioCardiacForce,
  type PhysioCardiacState,
} from './physio-cardiac';

export interface PhysioSimOpts {
  canvas: HTMLCanvasElement;
  particleCount?: number;
  bpm?: number;
}

export class PhysioHeartSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private renderer: ParticleRenderer;
  private solver: FluidSolver;
  private cardiac: PhysioCardiacState;
  private bpm: number;
  private raf = 0;
  private lastT = 0;
  private running = false;
  private prevPhase: PhysioCardiacState['phase'] = 'diastasis';

  fps = 0;
  msSolve = 0;
  msRender = 0;

  // FPS watchdog state.
  private targetFps = 30;
  private lowFpsTime = 0;
  private floor: number;
  // Dynamic fade-mask throttle.
  private maskFrameCounter = 0;

  constructor(opts: PhysioSimOpts) {
    this.canvas = opts.canvas;
    this.bpm = opts.bpm ?? 70;
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.renderer = new ParticleRenderer(gl);
    const targetCount = opts.particleCount ?? 4000;
    // Lite solver tuned for /heart/1: 1 constraint iter + viscosity off.
    // Halves solver cost vs default at the price of slightly looser density
    // resolution (PBF compensates with sCorr + explicit short-range repel).
    this.solver = new FluidSolver({
      count: targetCount,
      iterations: 1,
      viscosity: 0,
    });
    this.cardiac = makePhysioCardiacState(this.bpm);
    // Watchdog floor: never auto-shrink below 35% of the user's target.
    this.floor = Math.max(800, Math.floor(targetCount * 0.35));
  }

  setBpm(bpm: number): void { this.bpm = bpm; this.cardiac.bpm = bpm; }

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

  private frame(dt: number): void {
    this.resize();
    tickPhysioCardiac(this.cardiac, dt);

    // Trigger pulse wave on entry to ventricular ejection (the moment the
    // semilunar valves snap open). This couples the wave directly to the
    // physiological start of ejection rather than to the simple two-phase split.
    if (this.prevPhase !== 'ejection' && this.cardiac.phase === 'ejection') {
      triggerSystoleWaves();
    }
    this.prevPhase = this.cardiac.phase;

    this.solver.setValveStates(this.cardiac.valves);
    const bpmK = Math.min(2.5, Math.max(0.5, this.bpm / 70));
    this.solver.spawnSpeed = 8 + 18 * bpmK;
    this.solver.simTime = this.cardiac.t;
    // Map physio phase → systole/diastole binary for the wall-flex module.
    const inSystole = this.cardiac.phase === 'isoContract'
      || this.cardiac.phase === 'ejection'
      || this.cardiac.phase === 'isoRelax';
    this.solver.cardiacPhase = inSystole ? 'systole' : 'diastole';
    this.solver.cardiacPhaseFrac = this.cardiac.phaseFrac;
    this.solver.bpmK = bpmK;

    const force = makePhysioCardiacForce(this.solver, this.cardiac, () => this.bpm);

    const t0 = performance.now();
    const sub = SOLVER_CONSTS.N_SUBSTEPS;
    const subDt = dt / sub;
    for (let s = 0; s < sub; s++) this.solver.step(subDt, force);
    const t1 = performance.now();

    // Refresh the dynamic fade mask so vessels visibly contract/expand
    // where the cardiac wave is. Throttled to every 4 frames (~15Hz at 60fps,
    // ~7Hz at 30fps) — the pulse is slow enough that this looks smooth.
    if ((this.maskFrameCounter++ & 3) === 0) {
      const mask = buildDynamicFadeMask(bpmK);
      this.renderer.updateFadeMask(mask.data, mask.width, mask.height);
    }

    this.renderer.uploadParticles(this.solver.pos, this.solver.vel, this.solver.count);
    this.renderer.draw(this.canvas.width, this.canvas.height, this.solver.count, this.bpm);
    const t2 = performance.now();

    const k = 0.1;
    const inst = dt > 0 ? 1 / dt : 0;
    this.fps = this.fps === 0 ? inst : this.fps + (inst - this.fps) * k;
    this.msSolve = this.msSolve + ((t1 - t0) - this.msSolve) * k;
    this.msRender = this.msRender + ((t2 - t1) - this.msRender) * k;

    // FPS watchdog: if smoothed FPS sits below the target for ~1.5s,
    // shrink the active particle count by 15%. Don't grow back (avoids
    // oscillation); user can move the slider to test higher counts.
    if (this.fps > 0 && this.fps < this.targetFps) {
      this.lowFpsTime += dt;
      if (this.lowFpsTime > 1.5) {
        const cur = this.solver.count;
        const next = Math.max(this.floor, Math.floor(cur * 0.85));
        if (next < cur) this.solver.setActiveCount(next);
        this.lowFpsTime = 0;
      }
    } else {
      this.lowFpsTime = 0;
    }
  }

  getState() {
    return {
      bpm: this.bpm,
      phase: this.cardiac.phase,
      cyclePhi: this.cardiac.cyclePhi,
      valves: { ...this.cardiac.valves },
      particleCount: this.solver.count,
      fps: this.fps,
      msSolve: this.msSolve,
      msRender: this.msRender,
    };
  }

  dispose(): void { this.stop(); this.renderer.dispose(); }
}
