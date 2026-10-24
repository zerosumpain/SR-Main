// The page's side of the forecast worker. Each state revision gets one
// baseline; each plan edit asks for a 1-seed preview and then the 5-seed
// range, and an answer for an older edit is dropped, so the card only ever
// shows the plan on the map. Without Worker support (Node tests, an odd
// WebView) the same code runs on the main thread after a timeout.

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
  /** Forecast time of the last 5-seed range (telemetry: `simMs`). */
  lastMs = 0;

  constructor(
    private readonly onUpdate: (u: ForecastUpdate) => void,
    useWorker = typeof Worker !== 'undefined',
  ) {
    if (useWorker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<ForecastReply>) => this.reply(e.data);
        this.worker.onerror = () => {
          // A worker that cannot start (CSP, an old WebView) leaves the main thread to do it.
          this.worker = null;
        };
      } catch {
        this.worker = null;
      }
    }
  }

  /** A new state revision (a frame, a tick, a commit): its baseline starts computing now. */
  setState(town: TownState, snapshot: Snapshot, ctx: ForecastContext): void {
    const key = `${stateHash(town)}|${ctx.dayIndex}`;
    if (key === this.key) return;
    this.key = key;
    this.send({ id: ++this.serial, kind: 'baseline', key, town, snapshot, ctx });
  }

  /** A plan edit: the preview, then the range, each reported through onUpdate. */
  forecast(planId: string, town: TownState, snapshot: Snapshot, ctx: ForecastContext, plan: Command): void {
    const key = this.key || `${stateHash(town)}|${ctx.dayIndex}`;
    for (const seeds of [[FORECAST_SEEDS[0]], [...FORECAST_SEEDS]]) {
      const id = ++this.serial;
      this.latest = id;
      this.pending.set(id, planId);
      this.send({ id, kind: 'plan', key, town, snapshot, ctx, plan, seeds });
    }
  }

  /** Drop any answer still on its way (the plan was cleared or committed). */
  cancel(): void {
    this.latest = ++this.serial;
    this.pending.clear();
  }

  private send(req: ForecastRequest): void {
    if (this.worker) this.worker.postMessage(req);
    else setTimeout(() => this.reply(handleForecast(req, this.cache, () => (typeof performance !== 'undefined' ? performance.now() : 0))), 0);
  }

  private reply(r: ForecastReply): void {
    if (r.kind !== 'plan') return;
    const planId = this.pending.get(r.id);
    this.pending.delete(r.id);
    // The preview of the newest edit is fine to show while its range is computing; anything older is stale.
    if (planId === undefined || r.id < this.latest - 1) return;
    if (r.seeds > 1) this.lastMs = r.ms;
    this.onUpdate({ planId, seeds: r.seeds, forecast: r.forecast, ms: r.ms });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
