// The shape of the landing page's showcase: the chapters below the hero that
// show what the site does (Daydream, the health record, the app, and how it
// rewrites and ships itself), told in whichever of the hero's three views the
// visitor is reading (sentence, place or notes).
//
// Kept apart from showcase.server.ts so components can name the types without
// touching a server module. Every view's showcase takes the same props
// (ShowcaseProps), so the page can swap one for another exactly as it swaps
// the hero.
//
// Rules every figure here obeys:
//   - counts, totals, ratios and bands only: never a note, a title, a path, a
//     person, a place or a time of day that says where anyone is;
//   - null means "not answering" and renders as a dash, never as 0;
//   - nothing that reveals absence (how long the watch has been off, when the
//     phone last synced, whether anyone is out or asleep right now);
//   - no resting heart rate, HRV, weight, VO2 max or sleep clock times.

import type { CapabilityFacts } from './capabilities';
import type { LandingVitals } from './live-vitals.svelte';
import type { Pulse } from './sentence';
import type { StepsToday } from './steps';
import type { LocalDayCount } from '$lib/releases/local-days';
import type { OwnerSun } from './sun';

/** Daydream, the site's idle-hours thinking. */
export interface DaydreamShowcase {
  /** The last seven days of thinks (heartbeat pulses that ran, not skipped). */
  week: {
    /** Questions it asked itself (thinks that ran, ok or error). */
    questions: number;
    /** Wall-clock hours spent thinking, one decimal place. */
    hours: number;
    /** Look-ups it made while thinking (tool calls). */
    lookups: number;
    /** Claims its own auditor struck out (rejected notes + dropped citations). */
    struckOut: number;
    /** Areas of life it covered (distinct channels), out of `areas`. */
    areasCovered: number;
  } | null;
  /** The impact window (`windowDays`, rated notes). */
  impact: {
    /** Share of rated notes marked useful, 0..1, or null if none rated. */
    hitRate: number | null;
    /** The window before, for an up/down arrow. */
    previousHitRate: number | null;
    /** How many notes were rated in the window ("of N rated"). */
    rated: number;
    /** Notes that reached the owner in the window. */
    noticed: number;
    /** Ideas from Daydream that became shipped code (all time). */
    shipped: number;
    /** Ideas accepted onto the build list (all time). */
    accepted: number;
    /** Twelve weeks of verdicts, oldest first. */
    weeks: { start: string; useful: number; notUseful: number; undecided: number }[];
  } | null;
  /** Fixed facts imported from the feature, never literals. */
  rules: {
    cadenceMinutes: number;
    activeHours: { start: number; end: number };
    /** Thinking slots in a waking day: ceil((end-start)*60/cadence), the window being half-open. */
    slotsPerDay: number;
    /** Areas of life it rotates through. */
    areas: number;
    /** Most look-ups in one think. */
    maxLookups: number;
    /** Most notes one think may write. */
    maxNotes: number;
    /** Most notes raised to the owner in a day. */
    dailyRaiseCap: number;
    windowDays: number;
    /** ISO date the current loop started (days thinking = now - this). */
    loopStart: string;
  };
}

/** The health record, as public-safe aggregates. */
export interface HealthShowcase {
  /**
   * Daily step totals for the 30 London days ending on the latest COMPLETE day
   * with readings (never today), oldest first, null for a day with none. No
   * dates: the window ends where the readings do, so it never shows a gap at
   * the right that would say when the phone last synced.
   */
  steps30: Array<number | null> | null;
  /** Steps since 1 January (London), today included. */
  stepsYear: number | null;
  /** Days this year over 10,000 steps (complete days only). */
  daysOver10k: number | null;
  /** The best complete day this year. A past date is fine; never today. */
  bestDay: { date: string; steps: number } | null;
  /** Kilometres on foot since 1 January (walking + running distance, everyday walking included), one decimal. */
  kmYear: number | null;
  /** Recovery days in the last 30, by band (green >= 67, yellow >= 34, red below). */
  recovery30: { high: number; mid: number; low: number } | null;
  /** Average hours asleep over the last 7 nights, one decimal (naps excluded). */
  sleepAvg7: number | null;
  /** Last night's sleep and today's recovery, as bands only. */
  bands: { sleep: 'low' | 'mid' | 'high' | null; recovery: 'low' | 'mid' | 'high' | null };
  /** Kinds of Apple Health data the app reads (from the app's own manifest), or null if unknown. */
  kinds: number | null;
}

/** The SR App (iPhone + Apple Watch), counted from its own source. */
export interface AppShowcase {
  /** Pieces Apple ships: app, watch app, widget extensions. */
  targets: number;
  tabs: number;
  /** Tab names in order, e.g. today, chat, health... */
  tabNames: string[];
  watchPages: number;
  /** Home Screen widgets and Live Activities. */
  widgets: { name: string; surface: string }[];
  /** Watch complications. */
  complications: { name: string }[];
  /** Siri / Shortcuts phrases. */
  intents: { title: string }[];
  /** Family games, by name. */
  games: string[];
  backgroundModes: number;
  liveActivities: boolean;
  /** API endpoints the app talks to under /api/native. */
  nativeEndpoints: number;
  /** Areas those endpoints cover. */
  nativeAreas: number;
  /** A pairing code dies after this many minutes. */
  pairCodeMinutes: number;
  /** A paired device's key lasts this many days. */
  deviceTokenDays: number;
}

/** How it rewrites and ships itself: read from the release record already on the page. */
export interface BuildShowcase {
  releases: number | null;
  /** Lines added across all releases. */
  linesWritten: number | null;
  /** Days since the first deploy. */
  days: number | null;
  firstDeploy: string | null;
  deploysPerDay: number | null;
  deploysToday: number | null;
  /** Ideas Daydream had that shipped (same as daydream.impact.shipped). */
  fromDaydream: number | null;
}

/** Everything the server loads for the showcase in one memoised read. */
export interface ShowcaseData {
  daydream: DaydreamShowcase;
  health: HealthShowcase;
  app: AppShowcase;
  /** True only in a local preview running on fixture figures. */
  fixture?: boolean;
  /** Wildmind's valley; absent or null when it is not configured (then there is no chapter). */
  wildmind?: import('./wildmind').WildmindShowcase | null;
}

/** The props every view's showcase takes, identically. */
export interface ShowcaseProps {
  data: ShowcaseData;
  build: BuildShowcase;
  /** Live, polled every 15-60s (builder stage, canvases, next daydream). */
  v: LandingVitals | null;
  /** Wall clock, re-ticked every 30s. */
  now: number;
  /** The fresh-or-not pulse the hero uses; a showcase never shows a stale bpm. */
  pulse: Pulse;
  steps: StepsToday | null;
  /** London-day deploy counts (the hero's cadence). */
  cadence: LocalDayCount[];
  facts: CapabilityFacts;
  /**
   * The sun where the owner is (whole degrees, rising or not), or null for the
   * default sky. Only the place view draws it; the others ignore it.
   */
  sun?: OwnerSun | null;
}
