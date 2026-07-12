import { mulberry32 } from './topology';

// engine.ts — the scenario playback engine. Plain TS, DOM/Three-free, driven by
// tick(dtMs) from the scene's rAF loop. Scenarios are scripted sequences of steps;
// each step narrates one beat and schedules actions (pulses, fan-outs, flashes,
// log entries, counters). When idle the engine emits gentle ambient traffic so the
// network always looks alive. All timing scales with the speed multiplier.

export type PulseColor = 'query' | 'data' | 'ok' | 'refuse' | 'ambient';
export type LogKind = 'contract' | 'verify' | 'compute' | 'return' | 'refuse' | 'audit' | 'info';
export type CounterKey = 'exchanges' | 'pupilRecordsMoved' | 'aggregatesReturned' | 'refusals' | 'auditEntries';

export type SimAction =
  | { kind: 'pulse'; from: string; to: string; color: PulseColor; delayMs?: number; durMs?: number; count?: number; spreadMs?: number }
  | { kind: 'fanout'; supplier: string; count: number; color: PulseColor; delayMs?: number }
  | { kind: 'flash'; node: string; color: PulseColor; delayMs?: number }
  | { kind: 'highlight'; nodes: string[]; on: boolean; delayMs?: number }
  | { kind: 'log'; log: LogKind; text: string; delayMs?: number }
  | { kind: 'counter'; key: CounterKey; delta: number; delayMs?: number };

export interface ScenarioStep {
  narration: string;
  phase?: string; // short mono chip, e.g. "CONTRACT", "VERIFY", "LOCAL COMPUTE"
  holdMs: number; // beat length at speed 1 before the next step begins
  actions: SimAction[];
}

export interface QueryContract {
  requester: string;
  purpose: string;
  legalBasis: string;
  fields: string[];
  population: string;
  aggregation: string;
  retention: string;
}

export interface Scenario {
  id: string;
  group: string;
  title: string;
  tagline: string;
  description: string;
  lesson: string;
  contract?: QueryContract;
  /** links a query-shaped scenario to its FedQuery for the drill-down explorer */
  queryId?: string;
  /** declares that this scenario's actors include edtech tendrils, so the
   * component must make the ring visible before playing it */
  usesEdtech?: boolean;
  steps: ScenarioStep[];
  /** counterfactual shown in the comparison panel */
  central: { records: string; exposure: string; note: string };
}

export interface LogEntry {
  clock: string; // synthetic sim clock HH:MM:SS
  kind: LogKind;
  text: string;
  sig: string; // decorative signature stamp, X-Road flavour
}

export type SimEvent =
  | { type: 'narrate'; text: string; phase?: string; stepIndex: number; stepCount: number }
  | { type: 'pulse'; from: string; to: string; color: PulseColor; durMs: number }
  | { type: 'fanout'; supplier: string; count: number; color: PulseColor }
  | { type: 'flash'; node: string; color: PulseColor }
  | { type: 'highlight'; nodes: string[]; on: boolean }
  | { type: 'log'; entry: LogEntry }
  | { type: 'counter'; key: CounterKey; delta: number }
  | { type: 'scenario-start'; id: string }
  | { type: 'scenario-end'; id: string }
  /** the current stage's actions have all played — waiting for the user to advance */
  | { type: 'step-settled' }
  | { type: 'stopped' }
  | { type: 'clear' };

interface Pending { atMs: number; action: SimAction }

const DEFAULT_PULSE_MS = 1600;
/** while holding on a settled stage, replay its visual actions this often (wall-clock ms) */
const STEP_REPLAY_MS = 5000;

/** actions that are safe to re-fire on a stage replay — pure visuals, no side effects
 *  (re-firing log/counter actions would duplicate log rows and inflate the counters) */
function isVisualAction(a: SimAction): boolean {
  return a.kind === 'pulse' || a.kind === 'fanout' || a.kind === 'flash' || a.kind === 'highlight';
}

export interface AmbientPool {
  suppliers: string[];
  consumers: string[];
  /** the aggregate-collection hub the attendance trickle flows to (DfE) */
  hub: string;
  /** the audit-ledger node that flashes on ambient stamps */
  ledger: string;
  /** edtech tendrils — only breathe when the edtech ring is toggled on */
  edtech?: string[];
}

export class SimEngine {
  private listeners = new Set<(e: SimEvent) => void>();
  private scenario: Scenario | null = null;
  private lastLoaded: Scenario | null = null; // kept so replay works after scenario-end nulls `scenario`
  private stepIdx = -1;
  private clockMs = 9 * 3600 * 1000; // sim clock starts 09:00:00
  private timeMs = 0; // engine time (scaled)
  private stepStartMs = 0;
  /** true once the current stage's beat has fully played — the engine holds and
   *  replays the stage's visuals every STEP_REPLAY_MS until stepForward() */
  private awaitingNext = false;
  /** unscaled wall-clock ms accumulated since the last stage replay */
  private replayAccumMs = 0;
  private pending: Pending[] = [];
  private sigCounter = 0;
  private rng = mulberry32(0xfeed5);
  private nextAmbientMs = 800;
  playing = false;
  speed = 1;
  /** when true (and the pool has tendrils), ambient traffic includes edtech spurs */
  edtechActive = false;

  constructor(private ambient: AmbientPool) {}

  subscribe(fn: (e: SimEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SimEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private stamp(): string {
    this.sigCounter++;
    const h = (Math.imul(this.sigCounter, 2654435761) >>> 8).toString(16).padStart(6, '0');
    return `sig:${h.slice(0, 6)}`;
  }

  private clockStr(): string {
    const s = Math.floor(this.clockMs / 1000);
    const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  get activeScenario(): Scenario | null {
    return this.scenario;
  }

  loadScenario(s: Scenario) {
    this.emit({ type: 'clear' });
    this.scenario = s;
    this.lastLoaded = s;
    this.stepIdx = -1;
    this.pending = [];
    this.awaitingNext = false;
    this.playing = true;
    this.emit({ type: 'scenario-start', id: s.id });
    this.beginStep(0);
  }

  stop() {
    if (this.scenario) this.emit({ type: 'clear' });
    this.scenario = null;
    this.stepIdx = -1;
    this.pending = [];
    this.awaitingNext = false;
    this.playing = false;
    this.emit({ type: 'stopped' });
  }

  play() { this.playing = true; }
  pause() { this.playing = false; }
  toggle() { this.playing = !this.playing; }
  setSpeed(x: number) { this.speed = Math.max(0.25, Math.min(4, x)); }

  restart() {
    const s = this.scenario ?? this.lastLoaded;
    if (s) this.loadScenario(s);
  }

  /** User-driven advance: mid-beat it completes the beat instantly; once the
   *  stage has settled it drops any queued replays and begins the next stage. */
  stepForward() {
    if (!this.scenario || this.stepIdx < 0) return;
    if (this.awaitingNext) {
      // anything still pending here is a scheduled stage replay — discard it
      this.pending = [];
      this.awaitingNext = false;
    } else {
      const step = this.scenario.steps[this.stepIdx];
      this.timeMs = this.stepStartMs + step.holdMs;
      this.flushPending();
    }
    this.advance();
  }

  private beginStep(i: number) {
    const s = this.scenario;
    if (!s) return;
    if (i >= s.steps.length) {
      const id = s.id;
      this.scenario = null;
      this.stepIdx = -1;
      this.awaitingNext = false;
      this.playing = false;
      this.emit({ type: 'scenario-end', id });
      return;
    }
    this.stepIdx = i;
    this.stepStartMs = this.timeMs;
    this.awaitingNext = false;
    const step = s.steps[i];
    this.emit({ type: 'narrate', text: step.narration, phase: step.phase, stepIndex: i, stepCount: s.steps.length });
    for (const a of step.actions) {
      this.pending.push({ atMs: this.timeMs + (a.delayMs ?? 0), action: a });
    }
    this.flushPending(); // zero-delay actions land on the same beat as their narration
  }

  /** re-fire the settled stage's visual actions with their original in-beat timing */
  private replayStepVisuals(step: ScenarioStep) {
    for (const a of step.actions) {
      if (isVisualAction(a)) this.pending.push({ atMs: this.timeMs + (a.delayMs ?? 0), action: a });
    }
    this.flushPending();
  }

  private advance() {
    this.beginStep(this.stepIdx + 1);
  }

  private fire(a: SimAction) {
    switch (a.kind) {
      case 'pulse': {
        const n = a.count ?? 1;
        const spread = a.spreadMs ?? 260;
        for (let i = 0; i < n; i++) {
          if (i === 0) {
            // travel time shares the speed multiplier so pulses land within their beat
            this.emit({ type: 'pulse', from: a.from, to: a.to, color: a.color, durMs: (a.durMs ?? DEFAULT_PULSE_MS) / this.speed });
          } else {
            this.pending.push({ atMs: this.timeMs + i * spread, action: { ...a, count: 1, delayMs: 0 } });
          }
        }
        break;
      }
      case 'fanout':
        this.emit({ type: 'fanout', supplier: a.supplier, count: a.count, color: a.color });
        break;
      case 'flash':
        this.emit({ type: 'flash', node: a.node, color: a.color });
        break;
      case 'highlight':
        this.emit({ type: 'highlight', nodes: a.nodes, on: a.on });
        break;
      case 'log':
        this.emit({ type: 'log', entry: { clock: this.clockStr(), kind: a.log, text: a.text, sig: this.stamp() } });
        break;
      case 'counter':
        this.emit({ type: 'counter', key: a.key, delta: a.delta });
        break;
    }
  }

  private flushPending() {
    // fire everything due at or before current engine time, in order
    this.pending.sort((x, y) => x.atMs - y.atMs);
    while (this.pending.length && this.pending[0].atMs <= this.timeMs) {
      const p = this.pending.shift()!;
      this.fire(p.action);
    }
  }

  /** Advance the engine. dtMs is real elapsed milliseconds since last tick. */
  tick(dtMs: number) {
    const dt = Math.min(dtMs, 250); // clamp tab-switch jumps
    if (!this.playing && !this.scenario) {
      // idle: ambient traffic still breathes, sim clock crawls
      this.ambientTick(dt);
      return;
    }
    if (!this.playing) return;
    const scaled = dt * this.speed;
    this.timeMs += scaled;
    this.clockMs += scaled * 45; // sim world runs faster than the wall clock
    this.flushPending();
    const s = this.scenario;
    if (s && this.stepIdx >= 0) {
      const step = s.steps[this.stepIdx];
      if (!this.awaitingNext) {
        // stage played out: hold for the user instead of auto-advancing
        if (this.timeMs - this.stepStartMs >= step.holdMs) {
          this.awaitingNext = true;
          this.replayAccumMs = 0;
          this.emit({ type: 'step-settled' });
        }
      } else {
        // replay the settled stage's visuals on a steady wall-clock cadence, so the
        // "repeats every 5 s" affordance holds at every playback speed. dt is unscaled;
        // timeMs/pulse-travel still scale, so the visuals themselves play at the chosen speed.
        this.replayAccumMs += dt;
        if (this.replayAccumMs >= STEP_REPLAY_MS) {
          this.replayAccumMs -= STEP_REPLAY_MS;
          this.replayStepVisuals(step);
        }
      }
    }
  }

  private ambientTick(dt: number) {
    this.clockMs += dt * 45;
    this.nextAmbientMs -= dt;
    if (this.nextAmbientMs > 0) return;
    this.nextAmbientMs = 700 + this.rng() * 1600;
    const { suppliers, consumers } = this.ambient;
    if (!suppliers.length || !consumers.length) return;
    const sup = suppliers[Math.floor(this.rng() * suppliers.length)];
    const tendrils = this.ambient.edtech ?? [];
    if (this.edtechActive && tendrils.length && this.rng() < 0.35) {
      // a tendril syncs with an estate, or contributes a signal to the hub
      const edt = tendrils[Math.floor(this.rng() * tendrils.length)];
      const dest = this.rng() < 0.6 ? sup : this.ambient.hub;
      this.emit({ type: 'pulse', from: edt, to: dest, color: 'ambient', durMs: 2000 });
      this.emit({ type: 'counter', key: 'exchanges', delta: 1 });
      return;
    }
    const roll = this.rng();
    if (roll < 0.55) {
      // attendance trickle: supplier → the collection hub
      this.emit({ type: 'pulse', from: sup, to: this.ambient.hub, color: 'ambient', durMs: 2200 });
      this.emit({ type: 'counter', key: 'exchanges', delta: 1 });
    } else if (roll < 0.85) {
      // an LA or other consumer asks a routine question
      const con = consumers[Math.floor(this.rng() * consumers.length)];
      this.emit({ type: 'pulse', from: con, to: sup, color: 'ambient', durMs: 2000 });
      this.emit({ type: 'counter', key: 'exchanges', delta: 1 });
    } else {
      // a citizen reads their ledger — no exchange, no counter
      this.emit({ type: 'flash', node: this.ambient.ledger, color: 'ambient' });
    }
  }
}
