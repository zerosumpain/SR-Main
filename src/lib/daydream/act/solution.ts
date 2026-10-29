// src/lib/daydream/act/solution.ts
//
// A note's SOLUTION: the one press that does what it suggests. PURE — the
// kinds, the checks a proposed solution must pass, its words, and how it is
// stored. Carrying one out is `solution.server.ts`.
//
// Owner, 2026-10-29: "Daydream should be solutions oriented … with limited
// options to single-press create a solution to the observation the value is
// limited." Over the 30 days before, 50 of 423 notes carried a one-tap step
// (diary, reminder, draft — `plan.ts`). The rest suggested things nothing
// could carry out: turn those lights off, keep a fixed wake time for three
// weeks, open /trips, build a watchdog.
//
// ── The kinds, beside "Do it for me" ───────────────────────────────────────
//
//   track   a tracker on one measured series with a daily target and an end
//           day: code checks it every cycle and reports the result once
//           (`track.ts`). Stop ends it.
//   home    turn OFF lights or switches the note's own cited cards name. Only
//           `turn_off`, only `light.` and `switch.` entities, at most five.
//           Undo turns them back on. Never a lock, an alarm, heating or a
//           cover — those domains cannot pass the check.
//   open    the page that does it: a site page the capability manifest lists,
//           or a link that appears in a cited card (an unsubscribe page, a
//           subscription's own settings).
//   build   the site cannot do it yet: one press files it on the build list
//           and accepts it for an overnight build.
//   watch   a standing Watch (`follow.ts`), with the note's words as its brief.
//
// The model PROPOSES one; code checks it against the note's own cards, the
// same rule `checkPlan` applies to a diary entry: nothing in a solution may
// come from anywhere but the evidence.

export const SOLVE_KINDS = ['track', 'home', 'open', 'build', 'watch'] as const;
export type SolveKind = (typeof SOLVE_KINDS)[number];

/** Series a tracker may follow: `health_series` keys plus time with family.
 *  `solution.test.ts` pins that each health key exists there. */
export const TRACK_METRICS = [
  'sleep_hours',
  'deep_minutes',
  'rem_minutes',
  'sleep_performance',
  'recovery',
  'hrv',
  'rhr',
  'strain',
  'steps',
  'active_energy',
  'daylight',
  'mindful',
  'mood',
  'walking_speed',
  'familyMinutes',
] as const;
export type TrackMetric = (typeof TRACK_METRICS)[number];

export const TRACK_WORDS: Record<TrackMetric, { label: string; unit: string }> = {
  sleep_hours: { label: 'Sleep', unit: 'h' },
  deep_minutes: { label: 'Deep sleep', unit: 'min' },
  rem_minutes: { label: 'REM sleep', unit: 'min' },
  sleep_performance: { label: 'Sleep performance', unit: '%' },
  recovery: { label: 'Recovery', unit: '%' },
  hrv: { label: 'HRV', unit: 'ms' },
  rhr: { label: 'Resting heart rate', unit: 'bpm' },
  strain: { label: 'Strain', unit: '' },
  steps: { label: 'Steps', unit: '' },
  active_energy: { label: 'Active energy', unit: 'kcal' },
  daylight: { label: 'Time in daylight', unit: 'min' },
  mindful: { label: 'Mindful minutes', unit: 'min' },
  mood: { label: 'Mood', unit: '' },
  walking_speed: { label: 'Walking speed', unit: 'm/s' },
  familyMinutes: { label: 'Time with family', unit: 'min' },
};

export const TRACK_MIN_DAYS = 7;
export const TRACK_MAX_DAYS = 42;
export const HOME_MAX_ENTITIES = 5;
/** The only domains `home` may touch, and only to turn them off. */
export const HOME_DOMAINS = ['light', 'switch'] as const;

export interface TrackPlan {
  kind: 'track';
  metric: TrackMetric;
  goal: 'at_least' | 'at_most';
  target: number;
  days: number;
  /** His words for it, e.g. "Sleep 7.5 hours a night". */
  label: string;
}
export interface HomePlan {
  kind: 'home';
  entities: string[];
}
export interface OpenPlan {
  kind: 'open';
  url: string;
  label: string;
}
export interface BuildPlan {
  kind: 'build';
  title: string;
  what: string;
}
export interface WatchPlan {
  kind: 'watch';
  description: string;
}
export type SolvePlan = TrackPlan | HomePlan | OpenPlan | BuildPlan | WatchPlan;

/** What happened when it was carried out. */
export interface SolveDone {
  at: string;
  /** track: the tracker; build: the backlog slug; home: what was switched. */
  ref?: string;
  href?: string;
  undoneAt?: string | null;
  /** home: the entities turned off, for Undo. */
  entities?: string[];
  message?: string;
}

export interface StoredSolve {
  kind: `solve:${SolveKind}`;
  label: string;
  payload: string;
  done?: SolveDone;
}

/** The prompt's shapes, one per kind. */
export const SOLVE_SHAPES = [
  '- Track a measured habit or experiment with a daily target: {"kind":"track","metric":"sleep_hours","goal":"at_least","target":7.5,"days":21,"label":"Sleep 7.5 hours a night"} — metric one of ' +
    `${TRACK_METRICS.join(', ')}; goal at_least or at_most; days ${TRACK_MIN_DAYS}–${TRACK_MAX_DAYS}.`,
  '- Turn off lights or switches a cited card names: {"kind":"home","entities":["light.study","switch.hall_lamp"]} — light.* and switch.* only, at most five, ids copied exactly from the cards.',
  '- Open the page that does it: {"kind":"open","url":"/trips","label":"Open your trips"} — a site page from WHAT THE SITE ALREADY DOES, or a link copied exactly from a cited card (an unsubscribe or subscription page).',
  '- The site cannot do it yet and should: {"kind":"build","title":"Away-mode lights check","what":"Each evening the house is empty, list lights left on and offer to turn them off."} — only when nothing in WHAT THE SITE ALREADY DOES or ALREADY ON THE BUILD LIST covers it.',
  '- Keep watching for it: {"kind":"watch","description":"Tell me when the hallway thermostat stops reporting for more than an hour."}',
] as const;

export type SolveCheck = { ok: true; plan: SolvePlan } | { ok: false; reason: string };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A site path (`/trips`, `/health?tab=x`) — no scheme, no host, no `//`. */
export function isSitePath(url: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(url);
}

/** Does a site path fall under one of the pages the manifest lists? */
export function pageAllowed(url: string, pages: ReadonlySet<string>): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  for (const p of pages) {
    const base = p.replace(/\/+$/, '') || '/';
    if (path === base || (base !== '/' && path.startsWith(`${base}/`))) return true;
  }
  return false;
}

/**
 * Check a proposed solution against the note's own evidence. `citedText` is
 * what the cited cards said; `sitePages` the manifest's live pages.
 */
export function checkSolve(raw: unknown, ctx: { citedText: string; sitePages: ReadonlySet<string> }): SolveCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'track': {
      const metric = str(r.metric, 40);
      if (!(TRACK_METRICS as readonly string[]).includes(metric)) return { ok: false, reason: `"${metric}" is not a series a tracker can follow` };
      const goal = r.goal === 'at_most' ? 'at_most' : r.goal === 'at_least' ? 'at_least' : null;
      if (!goal) return { ok: false, reason: 'goal must be at_least or at_most' };
      const target = typeof r.target === 'number' ? r.target : Number(r.target);
      if (!Number.isFinite(target)) return { ok: false, reason: 'target must be a number' };
      const days = Math.round(Number(r.days));
      if (!Number.isFinite(days) || days < TRACK_MIN_DAYS || days > TRACK_MAX_DAYS) return { ok: false, reason: `days must be ${TRACK_MIN_DAYS}–${TRACK_MAX_DAYS}` };
      const label = str(r.label, 80);
      if (label.length < 3) return { ok: false, reason: 'a tracker needs a label' };
      return { ok: true, plan: { kind: 'track', metric: metric as TrackMetric, goal, target, days, label } };
    }
    case 'home': {
      const ids = Array.isArray(r.entities) ? [...new Set(r.entities.filter((e): e is string => typeof e === 'string').map((e) => e.trim()))] : [];
      if (!ids.length) return { ok: false, reason: 'no entities' };
      if (ids.length > HOME_MAX_ENTITIES) return { ok: false, reason: `at most ${HOME_MAX_ENTITIES} entities` };
      for (const id of ids) {
        const m = /^([a-z_]+)\.[a-z0-9_]+$/.exec(id);
        if (!m || !(HOME_DOMAINS as readonly string[]).includes(m[1])) return { ok: false, reason: `${id} is not a light or switch` };
        if (!ctx.citedText.includes(id)) return { ok: false, reason: `${id} is not in the cited cards` };
      }
      return { ok: true, plan: { kind: 'home', entities: ids } };
    }
    case 'open': {
      const url = str(r.url, 500);
      const label = str(r.label, 60) || 'Open it';
      if (isSitePath(url)) {
        if (!pageAllowed(url, ctx.sitePages)) return { ok: false, reason: `${url} is not a page the site lists` };
        return { ok: true, plan: { kind: 'open', url, label } };
      }
      if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) return { ok: false, reason: 'url must be a site page or an https link' };
      if (!ctx.citedText.includes(url)) return { ok: false, reason: 'that link is not in the cited cards' };
      return { ok: true, plan: { kind: 'open', url, label } };
    }
    case 'build': {
      const title = str(r.title, 90);
      const what = str(r.what, 600);
      if (title.length < 5 || what.length < 20) return { ok: false, reason: 'a build needs a title and what it does' };
      return { ok: true, plan: { kind: 'build', title, what } };
    }
    case 'watch': {
      const description = str(r.description, 400);
      if (description.length < 12) return { ok: false, reason: 'a watch needs a description' };
      return { ok: true, plan: { kind: 'watch', description } };
    }
    default:
      return { ok: false, reason: `unknown kind "${String(r.kind)}"` };
  }
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** The button's words: what one press will do. */
export function solveLabel(plan: SolvePlan): string {
  switch (plan.kind) {
    case 'track': {
      const w = TRACK_WORDS[plan.metric];
      return `Track it for ${plan.days} days: ${w.label.toLowerCase()} ${plan.goal === 'at_least' ? '≥' : '≤'} ${num(plan.target)}${w.unit ? ` ${w.unit}` : ''}`;
    }
    case 'home':
      return `Turn off ${plan.entities.length === 1 ? plan.entities[0].split('.')[1].replace(/_/g, ' ') : `${plan.entities.length} ${plan.entities.every((e) => e.startsWith('light.')) ? 'lights' : 'devices'}`}`;
    case 'open':
      return plan.label;
    case 'build':
      return 'Build it';
    case 'watch':
      return 'Watch for it';
  }
}

/** One line under the button: what happens, in his terms. */
export function solveExplain(plan: SolvePlan): string {
  switch (plan.kind) {
    case 'track':
      return `Starts now: checked every day against your ${TRACK_WORDS[plan.metric].label.toLowerCase()} readings, with the result sent when it ends. “${plan.label}”. Stop any time.`;
    case 'home':
      return `Asks Home Assistant to turn off ${plan.entities.join(', ')}. Undo turns them back on.`;
    case 'open':
      return isSitePath(plan.url) ? `Opens ${plan.url} on the site, which already does this.` : `Opens ${plan.url.replace(/^https:\/\//, '').split('/')[0]} — the page the note's sources link to.`;
    case 'build':
      return `Puts “${plan.title}” on the build list, drafts its brief and accepts it — the builder takes one a night. ${plan.what}`;
    case 'watch':
      return `Starts a Watch: ${plan.description} Stop it any time.`;
  }
}

export function storeSolve(plan: SolvePlan, done: SolveDone | null = null): StoredSolve {
  return { kind: `solve:${plan.kind}`, label: solveLabel(plan), payload: JSON.stringify(plan), ...(done ? { done } : {}) };
}

/** The note's solution, if it has one this build can read. */
export function readSolve(actions: unknown): { stored: StoredSolve; plan: SolvePlan } | null {
  if (!Array.isArray(actions)) return null;
  for (const a of actions as StoredSolve[]) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('solve:') || typeof a.payload !== 'string') continue;
    try {
      const p = JSON.parse(a.payload) as SolvePlan;
      if (p && `solve:${p.kind}` === a.kind && (SOLVE_KINDS as readonly string[]).includes(p.kind)) return { stored: a, plan: p };
    } catch {
      /* not one this build can read */
    }
  }
  return null;
}

/** The note's actions with its solution replaced. */
export function withSolve(actions: unknown, entry: StoredSolve): unknown[] {
  const rest = (Array.isArray(actions) ? actions : []).filter((a) => !(typeof (a as { kind?: unknown })?.kind === 'string' && String((a as { kind: string }).kind).startsWith('solve:')));
  return [...rest, entry];
}

/** What the card draws. */
export interface SolutionView {
  kind: SolveKind;
  label: string;
  explain: string;
  state: 'ready' | 'done' | 'undone';
  /** Where it lives once done (the tracker, the backlog item, the page). */
  href: string | null;
  at: string | null;
  message: string | null;
  /** Can a second press take it back? */
  undoable: boolean;
}

export function solutionView(actions: unknown): SolutionView | null {
  const s = readSolve(actions);
  if (!s) return null;
  const d = s.stored.done ?? null;
  const state = !d ? 'ready' : d.undoneAt ? 'undone' : 'done';
  const href = d?.href ?? (s.plan.kind === 'open' ? s.plan.url : null);
  return {
    kind: s.plan.kind,
    label: s.stored.label || solveLabel(s.plan),
    explain: solveExplain(s.plan),
    state,
    href,
    at: d?.at ?? null,
    message: d?.message ?? null,
    undoable: state === 'done' && (s.plan.kind === 'track' || s.plan.kind === 'home'),
  };
}
