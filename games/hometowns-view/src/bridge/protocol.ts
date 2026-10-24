// Bridge version 1 between the map page and the iPhone app (spec §10.9, the
// Marbler pattern). The app's WKWebView registers a `hometowns` script
// message handler and calls `window.hometowns.*`; the page posts typed
// messages to the handler. The page does no authenticated network (§9.1):
// HometownsStore holds the SSE stream and posts moves, and feeds the page
// through these calls.
//
// VERSIONING. `boot` carries the app's bridge version and every page message
// carries `v` (the page's). A page that boots with a newer app keeps to v1
// calls; one that boots with an older app reports an error. Calls marked
// "v1 addition" are additive to §10.9's table: an app that never sends them
// loses nothing but that feature.

import type { HometownsWire, Op, VisitView } from '../engine';
import type { WireFrame } from '../core/frames';
import type { LensOrNone } from '../lenses';
import type { Tool } from '../plan/plan';

export const BRIDGE_VERSION = 1;
/** The script message handler the app registers. */
export const HANDLER = 'hometowns';

export type Thermal = 'nominal' | 'fair' | 'serious' | 'critical';

export interface BootArgs {
  bridge: number;
  engineHash: string;
  wire: HometownsWire | WireFrame;
  copyLevel: 'kid' | 'adult';
  theme: 'light' | 'dark';
  reduceMotion: boolean;
  locale: string;
  /** v1 addition: the phone's thermal state and Low Power Mode at boot. */
  thermal?: Thermal;
  lowPower?: boolean;
}

/** v1 addition: page settings the app can change at any time. */
export interface PageSettings {
  /** The flat top-down planning view (§9.3). */
  topDown?: boolean;
  thermal?: Thermal;
  lowPower?: boolean;
  reduceMotion?: boolean;
  copyLevel?: 'kid' | 'adult';
  theme?: 'light' | 'dark';
}

/** What the app may call on the page (`window.hometowns`). */
export interface HometownsApi {
  /** The bridge version this page speaks. */
  readonly bridge: number;
  readonly engineHash: string;
  boot(a: BootArgs): void;
  /** Each SSE frame, whole or delta (the page merges it, §10.7). */
  apply(frame: WireFrame): void;
  tool(t: Tool): void;
  lens(id: LensOrNone): void;
  focus(p: { x: number; y: number }): void;
  /** Advisor and wants deep links drop a ghost plan. */
  ghost(g: { plan: Op[] }): void;
  commitResult(r: { planId: string; ok: boolean; error?: string }): void;
  visit(view: VisitView | null): void;
  renderPhotos(stories: { storyId: string; x?: number; y?: number }[]): void;
  timelapse(fromTick: number): void;
  paused(on: boolean): void;
  /** v1 addition: the forecast card's buttons (Build it!, undo the last ghost, clear the plan). */
  planEdit(e: { action: 'commit' | 'undo' | 'clear' }): void;
  /** v1 addition. */
  settings(s: PageSettings): void;
}

/** The forecast card's numbers (§9.2, §9.8): p10–p90 ranges as [p10, p50, p90]. */
export interface ForecastCard {
  /** 1 while it is the quick preview, 5 once the range is in. */
  seeds: number;
  /** £ now (refunds netted). */
  cost: number;
  /** £ a month the plan adds in upkeep at Normal funding (catalogue). */
  upkeep: number;
  /** Change in monthly money and in people after `months`. */
  monthly: [number, number, number];
  people: [number, number, number];
  /** Change in happiness per FACE (workers, professionals, families, retirees, students). */
  happy: [number, number, number][];
  months: number;
  /** Game weeks until what the plan starts is built, and the same in real ms on this county's clock. */
  readyTicks: number;
  readyMs: number;
  /** Real ms until the next Regional Day: beyond it the forecast is an estimate ("after tomorrow"). */
  exactForMs: number;
  /** The engine's refusal, if the plan cannot be built as it stands. */
  refused: string | null;
}

/** The inspector card (§9.5), drawn by SwiftUI. */
export interface InspectCardMsg {
  title: string;
  kind: 'zone' | 'building' | 'road' | 'rail' | 'land' | 'locked' | 'want';
  level: number | null;
  tier: number | null;
  who: string | null;
  mood: string | null;
  wants: string[];
  landValue: { value: number; terms: [label: string, amount: number][] } | null;
  grow: { score: number; chance: number; blocked: string | null; terms: [key: string, amount: number][] } | null;
  /** "What would make it grow?": one sentence, and a ghost plan the app can drop with `ghost`. */
  growLine: string | null;
  growPlan: Op[] | null;
}

export type PageMessage =
  | { type: 'ready'; bridge: number; engineHash: string; paramsHash: string }
  | { type: 'plan'; planId: string; ops: Op[]; cost: number; forecast: ForecastCard | null }
  | { type: 'commit'; planId: string; ops: Op[] }
  | { type: 'inspect'; tile: number; card: InspectCardMsg }
  | { type: 'lensChanged'; id: LensOrNone; legend?: string[]; note?: string | null }
  | { type: 'photo'; storyId: string; png: string }
  | { type: 'speak'; text: string }
  | { type: 'haptic'; kind: 'tap' | 'ok' | 'bad' }
  | { type: 'needResync'; have: number | null }
  | { type: 'needReload'; engineHash: string }
  | { type: 'stats'; fps: number; minFps: number; simMs: number; thermal: Thermal; canary: { tick: number; ok: boolean; hash?: string } | null }
  | { type: 'error'; msg: string };

/** Every message as posted: the page's bridge version on each one. */
export type Posted = PageMessage & { v: number };
