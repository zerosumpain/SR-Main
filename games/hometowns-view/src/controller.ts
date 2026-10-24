// The page controller: everything the map page does that is the same in the
// app and in harness mode. It owns the map, the plan and its ghosts, the
// lenses, the inspector, the wants bubbles, the forecast worker, the
// time-lapse and the frame loop. Where the town comes from is someone else's
// job: the app session (frames over the bridge, with exact local ticks) or
// the harness (a county in the page) hands it a Source whenever it changes,
// and the controller tells its owner what happened through `out` (bridge
// messages) and `commit`.
//
// Thermal care (§9.15): the loop runs only while something needs a frame —
// a gesture, a repaint, a time-lapse, the harness clock, or decoration (at
// 30 fps, and not when the phone is hot, in Low Power Mode or under Reduce
// Motion). Otherwise it sleeps until the next tick is due, and while the
// app is in the background it does nothing at all.

import { paramsFor, paramsHash, stateHash, type Command, type Op, type Snapshot, type TownState } from './engine';
import type { ForecastCard, InspectCardMsg, PageMessage, PageSettings, Thermal } from './bridge/protocol';
import { ForecastClient, type ForecastUpdate } from './forecast/client';
import { FORECAST_MONTHS, type ForecastContext } from './forecast/core';
import { inspectTile } from './inspect';
import { wantsBubbles, type Bubble, type Derived } from './layers';
import { LENS_DEFS, cellWhy, lensData, lensesFor, needsSpace, readSpace, type CellWhy, type LensData, type LensOrNone, type Space, type SpaceEnv } from './lenses';
import { NO_TOOL, Plan, gestureOf, opFor, previewPlan, type PlanPreview, type PreviewEnv, type Tool } from './plan/plan';
import { createMapView, type MapView } from './render/map';
import { mapModel } from './render/model';
import { LapsePlayer, lapseFor } from './timelapse';

/** What the controller draws: one town, and what it needs to predict and forecast it. */
export interface Source {
  town: TownState;
  snapshot: Snapshot;
  ctx: ForecastContext;
  /** The instant of the town's last tick end (space reads, §5.10 seasonality). */
  at: number;
  derived: Derived | null;
  tickMs: number;
  /** Real ms until the next Regional Day (the forecast's "exact until"). */
  msToRegionalDay: number;
  /** True while this town is still being built by the server (it changes every tick). */
  live: boolean;
}

export interface ControllerHooks {
  /** A bridge message for the app (in harness mode, the harness chrome listens instead). */
  out(m: PageMessage): void;
  /** "Build it!": the plan as one atomic move. Return the refusal sentence, or null if it was sent. */
  commit(planId: string, ops: Op[]): string | null;
  /** The harness asks for frames while its clock runs. */
  wantsFrames?(): boolean;
  /** Called once per frame before drawing (the harness clock, app prediction). */
  beforeFrame?(now: number, budgetMs: number): void;
  /** When the next work is due with nothing animating (ms since the epoch), or null. */
  nextDue?(): number | null;
  /** Harness chrome: the lens readout and the inspector, which the app draws itself. */
  cellRead?(w: CellWhy | null): void;
  /** The time-lapse finished or was skipped (welcome back follows it, §9.9). */
  lapseDone?(): void;
}

export interface ControllerOptions {
  copyLevel: 'kid' | 'adult';
  reduceMotion: boolean;
  thermal?: Thermal;
  lowPower?: boolean;
  /** Draw the wants bubbles as DOM over the map. */
  bubbles?: boolean;
}

/** Per frame, the simulation may use this much wall time; the rest is the renderer's. */
const SIM_BUDGET_MS = 10;
/** Forecasts wait for the hand to rest this long after a ghost edit. */
const FORECAST_DEBOUNCE_MS = 120;
const STATS_EVERY_MS = 10_000;

export class Controller {
  map!: MapView;
  readonly plan: Plan;
  private src: Source | null = null;
  private tool: Tool = NO_TOOL;
  private lens: LensOrNone = 'none';
  private stroke: Op | null = null;
  private preview: PlanPreview | null = null;
  private forecast: ForecastClient;
  private card: ForecastCard | null = null;
  private forecastTimer: ReturnType<typeof setTimeout> | null = null;
  private space: { key: string; space: Space } | null = null;
  private lensCache: { key: string; data: LensData } | null = null;
  private lapse: LapsePlayer | null = null;
  private bubbleHost: HTMLElement | null = null;
  private bubbles: Bubble[] = [];
  /** Each bubble's size, measured once when drawn (reading it on every pan would force a layout per frame). */
  private bubbleSizes: [number, number][] = [];
  private rafPending = false;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private background = false;
  private lastFrameAt = 0;
  private fps = { frames: 0, since: 0, value: 0, min: Infinity, minWindow: Infinity };
  private simMs = 0;
  private lastStats = 0;
  private canary: { tick: number; ok: boolean; hash?: string } | null = null;
  private opts: Required<ControllerOptions>;

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: ControllerHooks,
    opts: ControllerOptions,
  ) {
    this.opts = { thermal: 'nominal', lowPower: false, bubbles: true, ...opts };
    this.plan = new Plan(60, 'plan');
    this.forecast = new ForecastClient((u) => this.onForecast(u));
  }

  async start(): Promise<void> {
    this.map = await createMapView(this.host, {
      tap: (tile, kind) => this.onTap(tile, kind),
      stroke: (from, to, phase) => this.onStroke(from, to, phase),
      hover: (tile) => this.onHover(tile),
      camera: () => {
        this.placeBubbles();
        this.wake();
      },
      resized: () => this.wake(),
    });
    if (this.opts.bubbles) {
      this.bubbleHost = document.createElement('div');
      this.bubbleHost.className = 'bubbles';
      this.host.appendChild(this.bubbleHost);
    }
    this.applyDecor();
    document.addEventListener('visibilitychange', () => this.setBackground(document.hidden));
    this.wake();
  }

  // ---- The source -------------------------------------------------------------------------------

  get town(): TownState | null {
    return this.src?.town ?? null;
  }

  get source(): Source | null {
    return this.src;
  }

  /** A new or changed town. `urgent` repaints at once (a move, a frame); ticks repaint at most 5 times a second. */
  setSource(src: Source, urgent = true): void {
    const first = !this.src;
    this.src = src;
    this.space = null;
    this.lensCache = null;
    this.forecast.setState(src.town, src.snapshot, src.ctx);
    // A lens the town no longer has (a fresh hamlet) falls back to the map.
    if (this.lens !== 'none' && !lensesFor(src.town.tier).includes(this.lens)) this.setLens('none');
    this.refreshPlan(false);
    this.bubbles = wantsBubbles(src.town, src.derived, this.opts.copyLevel);
    this.drawBubbles();
    this.repaint(urgent || first);
    if (first) this.map.fit(src.town);
  }

  private spaceEnv(): SpaceEnv | null {
    const s = this.src;
    if (!s) return null;
    return { env: { params: paramsFor(s.ctx.paramsVersion), snapshot: s.snapshot, rivalry: s.ctx.rivalry, mishaps: s.ctx.mishaps, dayIndex: s.ctx.dayIndex }, townIndex: s.ctx.townIndex, at: s.at };
  }

  /** The space read for the current state, computed once per state (it costs a month step's M2–M4). */
  spaceNow(): Space | null {
    const s = this.src;
    const env = this.spaceEnv();
    if (!s || !env) return null;
    const key = `${s.town.tick}|${s.town.planesRev}|${s.town.buildings.length}|${s.town.construction.length}`;
    if (this.space?.key === key) return this.space.space;
    try {
      this.space = { key, space: readSpace(s.town, env) };
    } catch {
      this.space = null;
      return null;
    }
    return this.space.space;
  }

  private lensNow(): LensData | null {
    const s = this.src;
    if (!s || this.lens === 'none') return null;
    const key = `${this.lens}|${s.town.tick}|${s.town.planesRev}|${s.town.lv}`;
    if (this.lensCache?.key === key) return this.lensCache.data;
    const space = needsSpace(this.lens) ? this.spaceNow() : null;
    if (needsSpace(this.lens) && !space) return null;
    const data = lensData(this.lens, s.town, space, paramsFor(s.ctx.paramsVersion));
    this.lensCache = { key, data };
    return data;
  }

  private repaintKey(): string {
    const t = this.src?.town;
    if (!t) return '';
    return [this.lens, this.map.projection, t.tick, t.planesRev, t.parcels, t.construction.join(','), t.buildings.length, t.buildings.map((b) => b[6]).join(''), this.lensCache?.key ?? '', this.lapse?.version ?? -1].join('|');
  }

  private repaint(urgent: boolean): void {
    const s = this.src;
    if (!s || !this.map) return;
    const lens = this.lensNow();
    this.map.update(s.town, () => mapModel(s.town, lens, this.lapse ? this.lapse.mask : null), this.repaintKey(), urgent);
    this.wake();
  }

  /** Repaints every chunk now (the frame-time check's worst case: a whole new town). */
  repaintAll(): void {
    const s = this.src;
    if (!s) return;
    this.map.invalidate();
    this.repaint(true);
  }

  // ---- Tools, lenses and the plan ----------------------------------------------------------------

  setTool(t: Tool): void {
    this.tool = t;
    this.stroke = null;
    this.map.setGesture(gestureOf(t));
    this.refreshPlan(false);
  }

  get currentTool(): Tool {
    return this.tool;
  }

  get currentLens(): LensOrNone {
    return this.lens;
  }

  setLens(id: LensOrNone): void {
    this.lens = id;
    this.lensCache = null;
    const def = id === 'none' ? null : LENS_DEFS[id];
    const data = this.lensNow();
    this.hooks.out({ type: 'lensChanged', id, legend: def ? [...(this.opts.copyLevel === 'kid' ? def.kid : def.legend)] : [], note: data?.note ?? null });
    this.hooks.cellRead?.(null);
    this.repaint(true);
  }

  /** Advisor and wants deep links (bridge `ghost`): replace the ghosts with a suggested plan. */
  ghost(ops: Op[]): void {
    this.plan.replace(ops);
    this.refreshPlan(true);
  }

  planEdit(action: 'commit' | 'undo' | 'clear'): void {
    if (action === 'undo') this.plan.undo();
    else if (action === 'clear') this.plan.clear();
    else return this.commit();
    this.refreshPlan(true);
  }

  /** Ghosts plus the stroke in progress, run through the engine; then (debounced) the forecast. */
  private refreshPlan(changed: boolean): void {
    const s = this.src;
    if (!s || !this.map) return;
    const ops = this.stroke ? [...this.plan.ops, this.stroke] : this.plan.ops;
    this.preview = ops.length ? previewPlan(s.town, ops, this.previewEnv()) : null;
    this.map.setGhosts(this.preview);
    this.wake();
    if (!changed) return;
    if (this.plan.empty) {
      this.forecast.cancel();
      this.card = null;
      this.hooks.out({ type: 'plan', planId: this.plan.planId, ops: [], cost: 0, forecast: null });
      return;
    }
    // The card appears at once with the engine's cost; the forecast fills in when the worker answers.
    const p = this.preview;
    this.card = null;
    this.hooks.out({ type: 'plan', planId: this.plan.planId, ops: [...this.plan.ops], cost: p?.cost ?? 0, forecast: null });
    if (this.forecastTimer) clearTimeout(this.forecastTimer);
    this.forecastTimer = setTimeout(() => {
      const src = this.src;
      if (!src || this.plan.empty) return;
      const cmd: Command = { type: 'build', planId: this.plan.planId, plan: [...this.plan.ops] };
      this.forecast.forecast(this.plan.planId, src.town, src.snapshot, src.ctx, cmd);
    }, FORECAST_DEBOUNCE_MS);
  }

  private previewEnv(): PreviewEnv {
    const s = this.src!;
    return { params: paramsFor(s.ctx.paramsVersion), dayIndex: s.ctx.dayIndex, profile: s.ctx.profile };
  }

  private onForecast(u: ForecastUpdate): void {
    const s = this.src;
    if (!s || u.planId !== this.plan.planId || this.plan.empty) return;
    const f = u.forecast;
    const preview = this.preview;
    this.card = {
      seeds: u.seeds,
      cost: preview?.cost ?? f.cost,
      upkeep: preview?.upkeep ?? 0,
      monthly: f.effect.monthly,
      people: f.effect.pop,
      happy: f.effect.happy,
      months: FORECAST_MONTHS,
      readyTicks: f.readyTicks,
      readyMs: f.readyTicks * s.tickMs,
      exactForMs: s.msToRegionalDay,
      refused: preview?.refused ?? f.refused,
    };
    if (u.seeds > 1) this.simMs = this.simMs * 0.5 + u.ms * 0.5;
    this.hooks.out({ type: 'plan', planId: this.plan.planId, ops: [...this.plan.ops], cost: this.card.cost, forecast: this.card });
  }

  get forecastCard(): ForecastCard | null {
    return this.card;
  }

  get planPreview(): PlanPreview | null {
    return this.preview;
  }

  /** "Build it!": the whole plan as one atomic move (§9.3). */
  commit(): void {
    const s = this.src;
    if (!s || this.plan.empty) return;
    const refused = this.preview?.refused ?? null;
    if (refused) {
      this.hooks.out({ type: 'haptic', kind: 'bad' });
      this.hooks.out({ type: 'error', msg: refused });
      return;
    }
    const planId = this.plan.planId;
    const ops = [...this.plan.ops];
    const err = this.hooks.commit(planId, ops);
    if (err) {
      this.hooks.out({ type: 'haptic', kind: 'bad' });
      this.hooks.out({ type: 'error', msg: err });
      return;
    }
    this.hooks.out({ type: 'haptic', kind: 'ok' });
    this.plan.committed();
    this.forecast.cancel();
    this.card = null;
    this.refreshPlan(false);
    this.hooks.out({ type: 'plan', planId: this.plan.planId, ops: [], cost: 0, forecast: null });
  }

  // ---- Gestures ----------------------------------------------------------------------------------

  private onStroke(from: [number, number], to: [number, number], phase: 'move' | 'end' | 'cancel'): void {
    if (this.tool.kind === 'eraser') {
      if (phase === 'end' && this.plan.erase(to[1] * 64 + to[0])) this.refreshPlan(true);
      return;
    }
    if (phase === 'cancel') {
      this.stroke = null;
      this.refreshPlan(false);
      return;
    }
    const op = opFor(this.tool, from[0], from[1], to[0], to[1]);
    if (phase === 'move') {
      this.stroke = op;
      this.refreshPlan(false);
      return;
    }
    this.stroke = null;
    if (op && !this.plan.add(op)) this.hooks.out({ type: 'error', msg: 'A plan can hold at most 60 steps: build this one first.' });
    this.hooks.out({ type: 'haptic', kind: 'tap' });
    this.refreshPlan(true);
  }

  private onTap(tile: [number, number], kind: 'tap' | 'long'): void {
    if (this.lapse) {
      // A tap skips the time-lapse.
      this.lapse.finish();
      this.lapse = null;
      this.repaint(true);
      this.hooks.lapseDone?.();
      return;
    }
    if (kind === 'long' || this.tool.kind === 'none') {
      if (kind === 'long') this.inspect(tile[0], tile[1]);
      else if (this.lens !== 'none') this.readCell(tile[0], tile[1]);
      else this.inspect(tile[0], tile[1]);
    }
  }

  private onHover(tile: [number, number] | null): void {
    if (!tile || this.lens === 'none') return;
    this.readCell(tile[0], tile[1]);
  }

  /** "Why is it 140 here?" under a lens (§9.4). */
  readCell(x: number, y: number): CellWhy | null {
    const s = this.src;
    const data = this.lensNow();
    if (!s || !data || this.lens === 'none') return null;
    const w = cellWhy(this.lens, data, this.lens === 'landValue' ? this.spaceNow() : null, x, y);
    this.hooks.cellRead?.(w);
    return w;
  }

  /** The inspector (§9.5): the card goes to the app (or the harness chrome). */
  inspect(x: number, y: number): InspectCardMsg | null {
    const s = this.src;
    if (!s) return null;
    const card = inspectTile(x, y, { t: s.town, space: this.spaceNow(), params: paramsFor(s.ctx.paramsVersion), derived: s.derived, env: this.previewEnv() });
    this.hooks.out({ type: 'inspect', tile: y * 64 + x, card });
    this.hooks.out({ type: 'haptic', kind: 'tap' });
    return card;
  }

  focus(x: number, y: number): void {
    this.map.focus(x, y);
    this.wake();
  }

  // ---- Wants bubbles (DOM over the map) ------------------------------------------------------------

  private drawBubbles(): void {
    const host = this.bubbleHost;
    if (!host) return;
    host.replaceChildren(
      ...this.bubbles.map((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'bubble' + (b.hatched ? ' hatched' : '');
        el.textContent = b.label;
        el.setAttribute('aria-label', `${b.label}. Why?`);
        el.addEventListener('click', () => {
          const card: InspectCardMsg = { title: b.label, kind: 'want', level: null, tier: null, who: null, mood: null, wants: [b.key], landValue: null, grow: null, growLine: null, growPlan: null };
          this.hooks.out({ type: 'inspect', tile: b.y * 64 + b.x, card });
        });
        return el;
      }),
    );
    this.bubbleSizes = Array.from(host.children).map((el) => [(el as HTMLElement).offsetWidth || 120, (el as HTMLElement).offsetHeight || 32]);
    this.placeBubbles();
  }

  private placeBubbles(): void {
    const host = this.bubbleHost;
    if (!host || !this.map) return;
    // Bubbles over one corner of town stack upwards instead of covering each other.
    const placed: [number, number, number, number][] = [];
    this.bubbles.forEach((b, k) => {
      const el = host.children[k] as HTMLElement | undefined;
      if (!el) return;
      const [x, y0] = this.map.tileToScreen(b.x, b.y);
      const [w, hgt] = this.bubbleSizes[k] ?? [120, 32];
      let y = y0 - hgt * 1.3;
      for (let tries = 0; tries < 4 && placed.some(([px, py, pw, ph]) => Math.abs(px - x) < (pw + w) / 2 && Math.abs(py - y) < (ph + hgt) / 2); tries++) y -= hgt + 4;
      placed.push([x, y, w, hgt]);
      el.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y)}px)`;
    });
  }

  // ---- Time-lapse ----------------------------------------------------------------------------------

  /** Replays the tile log since `fromTick` (§9.9). Returns false when there is nothing to replay. */
  timelapse(fromTick: number): boolean {
    const t = this.src?.town;
    if (!t) return false;
    const lapse = lapseFor(t, fromTick, this.opts.reduceMotion);
    if (!lapse) return false;
    this.lapse = new LapsePlayer(lapse);
    this.repaint(true);
    return true;
  }

  get replaying(): boolean {
    return this.lapse !== null;
  }

  // ---- Settings, background, decoration ------------------------------------------------------------

  settings(s: PageSettings): void {
    if (s.topDown !== undefined) {
      this.map.setProjection(s.topDown ? 'top' : 'iso');
      this.placeBubbles();
    }
    if (s.thermal) this.opts.thermal = s.thermal;
    if (s.lowPower !== undefined) this.opts.lowPower = s.lowPower;
    if (s.reduceMotion !== undefined) this.opts.reduceMotion = s.reduceMotion;
    if (s.copyLevel) this.opts.copyLevel = s.copyLevel;
    this.applyDecor();
    this.repaint(true);
  }

  get topDown(): boolean {
    return this.map.projection === 'top';
  }

  /** §9.15: decoration stops when the phone is hot or in Low Power Mode, and under Reduce Motion. */
  private applyDecor(): void {
    const hot = this.opts.thermal === 'serious' || this.opts.thermal === 'critical';
    this.map?.setDecor(!hot && !this.opts.lowPower && !this.opts.reduceMotion);
  }

  setBackground(on: boolean): void {
    this.background = on;
    if (!on) this.wake();
  }

  noteCanary(c: { tick: number; ok: boolean; hash?: string } | null): void {
    if (c) this.canary = c;
  }

  // ---- The loop ----------------------------------------------------------------------------------

  /** Asks for a frame (no-op while one is pending or the page is in the background). */
  wake(): void {
    if (this.background || this.rafPending || !this.map) return;
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    this.rafPending = true;
    requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.rafPending = false;
    if (this.background) return;
    const t0 = performance.now();
    this.hooks.beforeFrame?.(Date.now(), SIM_BUDGET_MS);
    const sim = performance.now() - t0;
    if (sim > 0.05) this.simMs = this.simMs * 0.9 + sim * 0.1;
    if (this.lapse) {
      const sparkles = this.lapse.step(now);
      if (sparkles.length) this.map.sparkle(sparkles);
      if (this.lapse.done) {
        this.lapse = null;
        this.hooks.lapseDone?.();
      }
      this.repaint(true);
    } else if (this.src) {
      this.repaint(false);
    }
    const drew = this.map.render(now);
    this.countFrame(now, drew);
    const busy = this.map.animating || this.lapse !== null || this.hooks.wantsFrames?.() === true || this.stroke !== null;
    if (busy) this.wake();
    else this.sleep();
  }

  /** With nothing to animate, wake for the next due tick only (the app's exact ticks, §10.9). */
  private sleep(): void {
    const due = this.hooks.nextDue?.() ?? null;
    if (due === null) return;
    const ms = Math.max(16, Math.min(60_000, due - Date.now()));
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.wake();
    }, ms);
  }

  private countFrame(now: number, drew: boolean): void {
    if (drew && this.lastFrameAt > 0) {
      const dt = now - this.lastFrameAt;
      if (dt > 0 && dt < 1000) this.fps.minWindow = Math.min(this.fps.minWindow, 1000 / dt);
    }
    if (drew) {
      this.fps.frames++;
      this.lastFrameAt = now;
    }
    if (now - this.fps.since >= 1000) {
      this.fps.value = (this.fps.frames * 1000) / Math.max(1, now - this.fps.since);
      this.fps.min = this.fps.minWindow;
      this.fps = { ...this.fps, frames: 0, since: now, minWindow: Infinity };
    }
    if (now - this.lastStats >= STATS_EVERY_MS) {
      this.lastStats = now;
      this.hooks.out({ type: 'stats', ...this.stats() });
    }
  }

  stats(): { fps: number; minFps: number; simMs: number; thermal: Thermal; canary: { tick: number; ok: boolean; hash?: string } | null } {
    return {
      fps: Math.round(this.fps.value),
      minFps: Number.isFinite(this.fps.min) ? Math.round(this.fps.min) : 0,
      simMs: Math.round(this.simMs * 100) / 100,
      thermal: this.opts.thermal,
      canary: this.canary,
    };
  }

  /** The engine identity a `ready` message reports. */
  static identity(engineHash: string, paramsVersion: Parameters<typeof paramsFor>[0] = 'v1'): { engineHash: string; paramsHash: string } {
    return { engineHash, paramsHash: paramsHash(paramsFor(paramsVersion)) };
  }

  /** The town's hash (tests, the canary). */
  hash(): string {
    return this.src ? stateHash(this.src.town) : '';
  }

  destroy(): void {
    this.forecast.destroy();
    this.map.destroy();
  }
}
