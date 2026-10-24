// App mode (spec §10.9): the page inside the iPhone app. The app's
// HometownsStore holds the SSE stream and forwards every frame here; this
// session merges them, keeps the server's town pristine for the next merge,
// and runs a copy of it forward at each tick boundary (exact local ticks).
// It checks the production canary, applies a committed plan optimistically
// until the server confirms or refuses it, and asks the app for a whole
// frame (needResync) or another page version (needReload) when it must.
//
// The server is always the authority: every frame replaces the predicted
// town.

import {
  ALL_PARCELS,
  ENGINE_HASH,
  applyBuild,
  commitTown,
  paramsFor,
  stateHash,
  type Op,
  type TownState,
  type VisitView,
} from './engine';
import { BRIDGE_VERSION, type BootArgs, type HometownsApi, type PageMessage } from './bridge/protocol';
import { cleanId, cleanLens, cleanOps, cleanPoint, cleanTool, requestReload } from './bridge/bridge';
import type { Controller, Source } from './controller';
import { FrameGap, mergeFrame, movesKey, type WireFrame } from './core/frames';
import { Predictor } from './core/predict';

const clone = (t: TownState): TownState => JSON.parse(JSON.stringify(t)) as TownState;

export class AppSession {
  /** The last whole frame, exactly as the server meant it (never mutated: deltas merge against it). */
  held: WireFrame | null = null;
  private predictor: Predictor | null = null;
  /** Server time minus local time, from the last frame. */
  private offset = 0;
  /** A committed plan the server has not confirmed yet. */
  private optimistic: { planId: string; ops: Op[] } | null = null;
  private visiting: VisitView | null = null;
  private profile: 'kid' | 'adult' = 'adult';
  private booted = false;

  constructor(
    private readonly c: Controller,
    private readonly post: (m: PageMessage) => void,
  ) {}

  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** needReload, at most once a minute and never back to a version this phone left (A39). */
  private reload(engineHash: string): void {
    if (cleanId(engineHash) && requestReload(ENGINE_HASH, engineHash, Date.now())) this.post({ type: 'needReload', engineHash });
  }

  // ---- App → page ----

  boot(a: BootArgs): void {
    if (!a || typeof a !== 'object') return this.post({ type: 'error', msg: 'boot needs its arguments' });
    if (typeof a.bridge !== 'number' || a.bridge < 1) return this.post({ type: 'error', msg: `bridge ${String(a.bridge)} is older than this page's bridge ${BRIDGE_VERSION}` });
    if (a.bridge > BRIDGE_VERSION) this.post({ type: 'error', msg: `the app speaks bridge ${a.bridge}; this page speaks ${BRIDGE_VERSION} and keeps to it` });
    this.booted = true;
    this.profile = a.copyLevel === 'kid' ? 'kid' : 'adult';
    this.c.settings({ reduceMotion: a.reduceMotion === true, copyLevel: this.profile, thermal: a.thermal, lowPower: a.lowPower === true });
    if (typeof a.engineHash === 'string' && a.engineHash !== ENGINE_HASH) this.reload(a.engineHash);
    if (a.wire) this.apply(a.wire as WireFrame);
    // On open, replay what happened since this phone last looked (§9.9).
    const t = this.held?.me?.town;
    if (t && t.tick - t.lastSeenTick > 4) this.c.timelapse(t.lastSeenTick);
  }

  apply(frame: WireFrame): void {
    if (!frame || typeof frame !== 'object' || typeof frame.rev !== 'number') return;
    let merged: WireFrame;
    try {
      merged = mergeFrame(this.held, frame);
    } catch (e) {
      if (e instanceof FrameGap) return this.post({ type: 'needResync', have: this.held?.rev ?? null });
      throw e;
    }
    const prev = this.held;
    this.offset = merged.serverNow - Date.now();
    const engine = merged.client?.engineHash;
    if (engine && engine !== ENGINE_HASH) {
      // The server runs another engine: load the page that matches it (A39 debounce), and only draw meanwhile.
      this.reload(engine);
      if (this.predictor) this.predictor.enabled = false;
    }
    this.held = merged;
    const me = merged.me;
    const town = me?.town;
    if (!me || !town || !me.snapshot || !me.predict) return;

    // The delta must rebuild exactly the server's town: if not, ask for a whole frame.
    if (me.townHash && stateHash(town) !== me.townHash) {
      this.held = null;
      return this.post({ type: 'needResync', have: merged.rev });
    }
    // The canary (§10.4 item 8): only when no move of ours landed in between, so both sides had the same inputs.
    if (this.predictor && !this.optimistic && prev && movesKey(prev) === movesKey(merged)) {
      const r = this.predictor.check(town.tick, me.townHash);
      if (r) {
        this.c.noteCanary(r);
        if (!r.ok) {
          this.post({ type: 'stats', ...this.c.stats(), canary: r });
          this.post({ type: 'needResync', have: merged.rev });
        }
      }
    }
    if (this.optimistic && (me.moves ?? []).some((m) => m.id === this.optimistic!.planId)) this.optimistic = null;
    this.rebuild();
  }

  /** The predicted town from the held frame (plus a plan still waiting for the server). */
  private rebuild(): void {
    const me = this.held?.me;
    if (!me?.town || !me.snapshot || !me.predict || !this.held) return;
    const town = clone(me.town);
    if (this.optimistic) {
      try {
        applyBuild(town, this.optimistic.planId, this.optimistic.ops, { params: paramsFor(me.predict.paramsVersion), dayIndex: me.predict.dayIndex, profile: this.profile });
        commitTown(town);
      } catch {
        // The plan no longer fits the server's town: the server will refuse it too.
        this.optimistic = null;
      }
    }
    const clock = { tickMs: this.held.clock.tickMs, gridTick: this.held.clock.gridTick, nextTickAt: this.held.clock.nextTickAt, nextRegionalDayAt: this.held.clock.nextRegionalDayAt, paused: this.held.clock.paused, napping: this.held.clock.napping };
    const enabled = this.predictor?.enabled ?? true;
    if (!this.predictor) this.predictor = new Predictor(town, me.predict, me.snapshot, clock);
    else this.predictor.reset(town, me.predict, me.snapshot, clock);
    this.predictor.enabled = enabled && (this.held.client?.engineHash ?? ENGINE_HASH) === ENGINE_HASH;
    this.predictor.dirty = this.optimistic !== null;
    if (this.optimistic) this.predictor.forget();
    this.predictor.advance(this.serverNow());
    if (!this.visiting) this.c.setSource(this.source(), true);
  }

  private source(): Source {
    const f = this.held!;
    const me = f.me!;
    const p = me.predict!;
    const t = this.predictor!.town;
    return {
      town: t,
      snapshot: me.snapshot!,
      ctx: { townIndex: p.townIndex, dayIndex: p.dayIndex, rivalry: p.rivalry, mishaps: p.mishaps, paramsVersion: p.paramsVersion, profile: this.profile },
      at: f.clock.nextTickAt - f.clock.tickMs,
      derived: me.derived ?? null,
      tickMs: f.clock.tickMs,
      msToRegionalDay: Math.max(0, f.clock.nextRegionalDayAt - this.serverNow()),
      live: true,
    };
  }

  /** "Build it!": apply the plan to the predicted town at once (pending) and ask the app to post it. */
  commit(planId: string, ops: Op[]): string | null {
    const me = this.held?.me;
    if (!this.predictor || !me?.predict) return 'The town is still loading.';
    if (this.visiting) return 'You are visiting another town.';
    const before = JSON.stringify(this.predictor.town);
    try {
      applyBuild(this.predictor.town, planId, ops, { params: paramsFor(me.predict.paramsVersion), dayIndex: me.predict.dayIndex, profile: this.profile });
      // Write the edited planes back, so copies (the forecast worker, the plan preview) and hashes see the plan.
      commitTown(this.predictor.town);
    } catch (e) {
      this.predictor.town = JSON.parse(before) as TownState;
      return e instanceof Error ? e.message : String(e);
    }
    this.optimistic = { planId, ops };
    this.predictor.dirty = true;
    this.predictor.forget();
    this.post({ type: 'commit', planId, ops });
    this.c.setSource(this.source(), true);
    return null;
  }

  commitResult(r: { planId: string; ok: boolean; error?: string }): void {
    const planId = cleanId(r?.planId);
    if (!planId || this.optimistic?.planId !== planId) return;
    if (r.ok) return; // kept until a frame lists it
    this.optimistic = null;
    this.post({ type: 'haptic', kind: 'bad' });
    if (typeof r.error === 'string') this.post({ type: 'error', msg: r.error.slice(0, 200) });
    this.rebuild();
  }

  /** Show another town, read-only and without finances (§9.10 Visit), or come home. */
  visit(view: VisitView | null): void {
    this.visiting = view && typeof view === 'object' && typeof view.planes === 'string' ? view : null;
    const home = this.predictor?.town;
    if (!this.visiting) {
      if (home) this.c.setSource(this.source(), true);
      return;
    }
    if (!home || !this.held?.me?.snapshot) return;
    const v = this.visiting;
    // A visited town is drawn from its planes alone: the rest of the record is the viewer's, never shown.
    const shown = { ...clone(home), seat: v.seat, planes: v.planes, planesRev: -1, lv: v.lv, buildings: v.buildings.map((b) => [...b]), terrainSeed: v.terrainSeed, siteKind: v.siteKind as TownState['siteKind'], terrainEdits: [...v.terrainEdits], construction: [...v.construction], parcels: ALL_PARCELS };
    this.c.setTool({ kind: 'none' });
    this.c.setSource({ ...this.source(), town: shown, derived: null }, true);
  }

  // ---- The frame loop's hooks ----

  beforeFrame(): void {
    if (!this.predictor || this.visiting) return;
    if (this.predictor.advance(this.serverNow()) > 0) this.c.setSource(this.source(), false);
  }

  nextDue(): number | null {
    const due = this.predictor?.nextDue() ?? null;
    return due === null ? null : due - this.offset;
  }

  /** The API the app calls (`window.hometowns`), with everything it hands in checked first. */
  api(): HometownsApi {
    const c = this.c;
    return {
      bridge: BRIDGE_VERSION,
      engineHash: ENGINE_HASH,
      boot: (a) => this.boot(a),
      apply: (f) => this.apply(f),
      tool: (t) => {
        const tool = cleanTool(t);
        if (tool && !this.visiting) c.setTool(tool);
      },
      lens: (id) => {
        const lens = cleanLens(id);
        if (lens) c.setLens(lens);
      },
      focus: (p) => {
        const pt = cleanPoint(p);
        if (pt) c.focus(pt.x, pt.y);
      },
      ghost: (g) => {
        const ops = cleanOps(g?.plan);
        if (ops && !this.visiting) c.ghost(ops);
      },
      commitResult: (r) => this.commitResult(r),
      visit: (v) => this.visit(v),
      renderPhotos: (stories) => void renderPhotos(c, stories, this.post),
      timelapse: (from) => {
        if (typeof from === 'number' && Number.isFinite(from)) c.timelapse(Math.floor(from));
      },
      paused: (on) => c.setBackground(on === true),
      planEdit: (e) => {
        if (e && (e.action === 'commit' || e.action === 'undo' || e.action === 'clear') && !this.visiting) c.planEdit(e.action);
      },
      settings: (s) => {
        if (s && typeof s === 'object') c.settings(s);
      },
    };
  }

  get isBooted(): boolean {
    return this.booted;
  }
}

/** Gazette photos (§9.9): the reader's own town, framed on each story's tile, as PNG data URLs. */
async function renderPhotos(c: Controller, stories: unknown, post: (m: PageMessage) => void): Promise<void> {
  if (!Array.isArray(stories)) return;
  for (const s of stories.slice(0, 8)) {
    const id = cleanId((s as { storyId?: unknown })?.storyId);
    if (!id) continue;
    const pt = cleanPoint(s);
    if (pt) c.focus(pt.x, pt.y);
    else c.map.fit();
    c.map.render(performance.now());
    try {
      const png = await c.map.app.renderer.extract.base64({ target: c.map.app.stage, format: 'png' });
      post({ type: 'photo', storyId: id, png });
    } catch (e) {
      post({ type: 'error', msg: `photo ${id}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  c.map.fit();
}
