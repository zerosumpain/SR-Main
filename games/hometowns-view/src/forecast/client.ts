// The page's side of the forecast worker. Each plan edit asks for a 1-seed
// preview and then the 5-seed range, and an answer for an older edit is
// dropped, so the card only ever shows the plan on the map. The worker does
// one request at a time and only the newest job waits behind it: a town
// ticking at the harness's top speed changes state every frame, and work
// queued for each of those states would starve the plan's own forecast. A
// state's baseline is worked out ahead only while a plan or a tool is in
// hand (`eager`); otherwise the first plan request computes it. Without
// Worker support (Node tests, an odd WebView) the same code runs on the main
// thread after a timeout.

import { stateHash, type Command, type PlanForecast, type Snapshot, type TownState } from '../engine';
import { FORECAST_SEEDS, handleForecast, type ForecastCache, type ForecastContext, type ForecastReply, type ForecastRequest } from './core';

export interface ForecastUpdate {
  planId: string;
  /** 1 for the quick preview, 5 for the range. */
  seeds: number;
  forecast: PlanForecast;
  ms: number;
}

export class ForecastClient {
  private worker: Worker | null = null;
  private cache: ForecastCache = { key: '', baseline: null };
  private serial = 0;
  /** The newest plan request id: replies to older ones are stale. */
  private latest = 0;
  private key = '';
  private pending = new Map<number, string>();
  /** A request is with the worker (or on the main thread's queue). */
  private busy = false;
  /** The newest job's requests not yet sent: a new job replaces them. */
  private queue: ForecastRequest[] = [];
  /** The newest job is a plan's: a later state's baseline does not displace it. */
  private queuedPlan = false;
  /** Forecast time of the last 5-seed range (telemetry: `simMs`). */
  lastMs = 0;

  constructor(
    private readonly onUpdate: (u: ForecastUpdate) => void,
    useWorker = typeof Worker !== 'undefined',
    private readonly onError: (planId: string, message: string) => void = () => {},
  ) {
    if (useWorker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<ForecastReply>) => this.reply(e.data);
        this.worker.onerror = () => {
          // A worker that cannot start (CSP, an old WebView) leaves the main thread to do it.
          this.worker = null;
          this.busy = false;
          this.pump();
        };
      } catch {
        this.worker = null;
      }
    }
  }

  /**
   * A new state revision (a frame, a tick, a commit). With `eager` (a plan
   * or a tool is in hand) its baseline starts computing now, unless a plan's
   * forecast is already waiting, which works it out itself.
   */
  setState(town: TownState, snapshot: Snapshot, ctx: ForecastContext, eager = true): void {
    const key = `${stateHash(town)}|${ctx.dayIndex}`;
    if (key === this.key) return;
    this.key = key;
    if (!eager || this.queuedPlan) return;
    this.enqueue([{ id: ++this.serial, kind: 'baseline', key, town, snapshot, ctx }], false);
  }

  /** A plan edit: the preview, then the range, each reported through onUpdate. */
  forecast(planId: string, town: TownState, snapshot: Snapshot, ctx: ForecastContext, plan: Command): void {
    // The state's key, which setState has always just set for this very town.
    const key = this.key || `${stateHash(town)}|${ctx.dayIndex}`;
    const job: ForecastRequest[] = [];
    for (const seeds of [[FORECAST_SEEDS[0]], [...FORECAST_SEEDS]]) {
      const id = ++this.serial;
      this.latest = id;
      this.pending.set(id, planId);
      job.push({ id, kind: 'plan', key, town, snapshot, ctx, plan, seeds });
    }
    this.enqueue(job, true);
  }

  /** Drop any answer still on its way (the plan was cleared or committed). */
  cancel(): void {
    this.latest = ++this.serial;
    this.pending.clear();
    this.queue = [];
    this.queuedPlan = false;
  }

  private enqueue(job: ForecastRequest[], plan: boolean): void {
    for (const r of this.queue) this.pending.delete(r.id);
    this.queue = job;
    this.queuedPlan = plan;
    this.pump();
  }

  private pump(): void {
    if (this.busy) return;
    const req = this.queue.shift();
    if (!req) {
      this.queuedPlan = false;
      return;
    }
    this.busy = true;
    if (this.worker) this.worker.postMessage(req);
    else setTimeout(() => this.reply(handleForecast(req, this.cache, () => (typeof performance !== 'undefined' ? performance.now() : 0))), 0);
  }

  private reply(r: ForecastReply): void {
    this.busy = false;
    this.handle(r);
    this.pump();
  }

  private handle(r: ForecastReply): void {
    if (r.kind === 'baseline') return;
    const planId = this.pending.get(r.id);
    this.pending.delete(r.id);
    // The preview of the newest edit is fine to show while its range is computing; anything older is stale.
    if (planId === undefined || r.id < this.latest - 1) return;
    if (r.kind === 'error') return this.onError(planId, r.message);
    if (r.seeds > 1) this.lastMs = r.ms;
    this.onUpdate({ planId, seeds: r.seeds, forecast: r.forecast, ms: r.ms });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
