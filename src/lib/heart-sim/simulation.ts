// Top-level orchestrator: wires solver + cardiac controller + renderer
// behind a tiny start/stop API for the Svelte component.

import { ParticleRenderer } from './renderer';
import {
  FluidSolver,
  makeCardiacForce,
  makeCardiacState,
  tickCardiac,
  triggerSystoleWaves,
  SOLVER_CONSTS,
  type CardiacState,
} from './solver';

export interface SimulationOpts {
  canvas: HTMLCanvasElement;
  particleCount?: number;
  bpm?: number;
}

export class HeartSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private renderer: ParticleRenderer;
  private solver: FluidSolver;
  private cardiac: CardiacState;
  private bpm: number;
  private raf = 0;
  private lastT = 0;
  private running = false;
  private dpr = 1;

  private prevPhase: 'systole' | 'diastole' = 'diastole';

  // Rolling FPS measurement (last ~60 frames).
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 0;
  msSolve = 0;
  msRender = 0;

  constructor(opts: SimulationOpts) {
    this.canvas = opts.canvas;
    this.bpm = opts.bpm ?? 70;

    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      premultipliedAlpha: true,
      alpha: true,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.renderer = new ParticleRenderer(gl);
    this.solver = new FluidSolver({ count: opts.particleCount ?? 3000 });
    this.cardiac = makeCardiacState(this.bpm);
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.cardiac.bpm = bpm;
  }

  resize(): void {
    // Cap DPR aggressively — fragment fill cost grows with DPR² and the
    // particles already look fine at 1.25× on retina.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.dpr = dpr;
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

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number): void {
    this.resize();

    tickCardiac(this.cardiac, dt);
    // On the diastole→systole transition, spawn a fresh pulse wave at the
    // origin of every systolic-triggered artery. This couples ventricular
    // ejection directly to wave propagation through the aorta and pulm trunk.
    if (this.prevPhase === 'diastole' && this.cardiac.phase === 'systole') {
      triggerSystoleWaves();
    }
    this.prevPhase = this.cardiac.phase;

    this.solver.setValveStates(this.cardiac.valves);
    const bpmK = Math.min(2.5, Math.max(0.5, this.bpm / 70));
    this.solver.spawnSpeed = 8 + 18 * bpmK;

    // Feed cardiac context to the solver so wall-flex pulses with the heart.
    this.solver.simTime = this.cardiac.t;
    this.solver.cardiacPhase = this.cardiac.phase;
    this.solver.cardiacPhaseFrac = this.cardiac.phaseFrac;
    this.solver.bpmK = bpmK;

    const force = makeCardiacForce(this.solver, this.cardiac, () => this.bpm);

    const t0 = performance.now();
    const sub = SOLVER_CONSTS.N_SUBSTEPS;
    const subDt = dt / sub;
    for (let s = 0; s < sub; s++) this.solver.step(subDt, force);
    const t1 = performance.now();

    this.renderer.uploadParticles(this.solver.pos, this.solver.vel, this.solver.count);
    this.renderer.draw(this.canvas.width, this.canvas.height, this.solver.count, this.bpm);
    const t2 = performance.now();

    // Smooth FPS / timings (EMA).
    const k = 0.1;
    const instFps = dt > 0 ? 1 / dt : 0;
    this.fps = this.fps === 0 ? instFps : this.fps + (instFps - this.fps) * k;
    this.msSolve = this.msSolve + ((t1 - t0) - this.msSolve) * k;
    this.msRender = this.msRender + ((t2 - t1) - this.msRender) * k;
    this.fpsAcc += dt;
    this.fpsFrames++;
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }

  getState() {
    return {
      bpm: this.bpm,
      phase: this.cardiac.phase,
      phaseFrac: this.cardiac.phaseFrac,
      valves: { ...this.cardiac.valves },
      particleCount: this.solver.count,
      fps: this.fps,
      msSolve: this.msSolve,
      msRender: this.msRender,
    };
  }
}
