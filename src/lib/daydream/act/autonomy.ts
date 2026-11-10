// src/lib/daydream/act/autonomy.ts
//
// The autonomy ladder: which of a note's steps jkai carries out BY ITSELF and
// tells him about afterwards, and which wait for his tap. PURE — the kinds,
// the rules that move a kind up and down, and the state's shape. Reading and
// writing it is `autonomy.server.ts`; carrying a step out is
// `standing.server.ts`.
//
// Owner, 2026-11-10: "I want the process to be more assertive and action
// oriented." Over the 30 days before, 295 notes offered 72 one-press steps and
// 5 were pressed: every action waited for a tap that did not come. He chose
// do-then-tell for what can be taken back.
//
// ── The three tiers ────────────────────────────────────────────────────────
//
//   do     carried out when the note is written, then told with an Undo:
//          lights off in an empty house, a reminder, a tracker, an email
//          DRAFT. Each is put back by one press and touches nobody else.
//   ask    one tap, as before: switches, anything in his diary, a build, a
//          page to open — the tool contract refuses these to an unattended
//          caller (`invoke-contract.ts`) and this does not weaken it. And a
//          watch: it becomes a scheduled workflow generated from the note's
//          description, which no contract bounds.
//   never  sending, paying, booking, cancelling, locks, heating. No tier
//          reaches them; there is no kind for them at all.
//
// A kind is not fixed on `do`. Two of its automatic acts undone inside thirty
// days puts it back to `ask`; three taps on it there put it forward again. He
// can set either by hand on the Solutions page, and a kind HE set to ask is
// never moved forward by the ladder.

import { readStored } from './plan';
import { readSolve } from './solution';

export const AUTO_KINDS = ['solve:home', 'solve:track', 'reminder', 'email_draft'] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];
export type Level = 'ask' | 'do';

export const AUTO_WORDS: Record<AutoKind, { label: string; does: string; undo: string }> = {
  'solve:home': {
    label: 'Lights off in an empty house',
    does: 'Turns off lights a note finds left on when nobody is home, and turns them back on when someone returns.',
    undo: 'Undo turns them back on.',
  },
  'solve:track': { label: 'Trackers', does: 'Starts a tracker on a measured habit a note proposes.', undo: 'Undo stops it.' },
  reminder: { label: 'Reminders', does: 'Sets the reminder a note proposes. It arrives on your phone.', undo: 'Undo cancels it.' },
  email_draft: { label: 'Email drafts', does: 'Writes the reply a note proposes as a Gmail draft. Sending is always your tap.', undo: 'Undo discards the draft.' },
};

/** What stays one tap, and why, for the Solutions page. */
export const ASK_ONLY: ReadonlyArray<{ label: string; why: string }> = [
  { label: 'Watches', why: 'A watch becomes a scheduled workflow written from the note\'s own words, and those words can come from mail or the web.' },
  { label: 'Switches', why: 'A switch can be wired to anything — a heater, a pump, a gate.' },
  { label: 'Your diary', why: 'Adding, holding or moving an entry writes to a calendar other people may see.' },
  { label: 'Builds', why: 'A build changes the site and spends an overnight run.' },
  { label: 'Pages and links', why: 'Opening a page is yours to do.' },
];

/** Automatic acts undone inside the window that put a kind back to ask. */
export const DEMOTE_UNDOS = 2;
export const DEMOTE_WINDOW_DAYS = 30;
/** Taps on a kind the ladder put back that move it forward again. */
export const PROMOTE_TAPS = 3;
/** Automatic acts in one local day, across every kind. */
export const AUTO_DAILY_CAP = 6;
const LOG_KEEP = 80;
const DAY_MS = 86_400_000;

export interface AutoLogEntry {
  at: string;
  kind: AutoKind;
  thoughtId: string;
  title: string;
  /** He took it back. Counts towards putting the kind back to ask. */
  undoneAt?: string;
  /** Lights turned back on because someone came home. Not an undo. */
  restoredAt?: string;
}

export interface AutonomyState {
  levels: Partial<Record<AutoKind, { level: Level; by: 'owner' | 'ladder'; at: string }>>;
  taps: Partial<Record<AutoKind, number>>;
  log: AutoLogEntry[];
}

export const EMPTY_AUTONOMY: AutonomyState = { levels: {}, taps: {}, log: [] };

const isAutoKind = (v: unknown): v is AutoKind => (AUTO_KINDS as readonly string[]).includes(String(v));

/** Whatever the setting holds, as a state this build can read. */
export function cleanState(raw: unknown): AutonomyState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const levels: AutonomyState['levels'] = {};
  const taps: AutonomyState['taps'] = {};
  for (const k of AUTO_KINDS) {
    const l = (r.levels as Record<string, { level?: unknown; by?: unknown; at?: unknown }> | undefined)?.[k];
    if (l && (l.level === 'ask' || l.level === 'do')) levels[k] = { level: l.level, by: l.by === 'ladder' ? 'ladder' : 'owner', at: typeof l.at === 'string' ? l.at : new Date(0).toISOString() };
    const t = Number((r.taps as Record<string, unknown> | undefined)?.[k]);
    if (Number.isFinite(t) && t > 0) taps[k] = Math.floor(t);
  }
  const log = (Array.isArray(r.log) ? (r.log as AutoLogEntry[]) : [])
    .filter((e) => e && isAutoKind(e.kind) && typeof e.at === 'string' && typeof e.thoughtId === 'string')
    .slice(-LOG_KEEP);
  return { levels, taps, log };
}

/** Every automatic kind starts on `do` — his choice, 2026-11-10. */
export function levelOf(state: AutonomyState, kind: AutoKind): Level {
  return state.levels[kind]?.level ?? 'do';
}

/**
 * The step on a note that could be carried out without him, or null. A `do`
 * plan wins over a solution, as it does on the card. Lights only: a `home`
 * solution naming any switch stays a tap.
 */
export function autoKindOf(actions: unknown): { kind: AutoKind; via: 'do' | 'solve' } | null {
  const act = readStored(actions);
  if (act && !act.stored.done && isAutoKind(act.plan.kind)) return { kind: act.plan.kind, via: 'do' };
  if (act) return null;
  const s = readSolve(actions);
  if (!s || s.stored.done) return null;
  const kind = `solve:${s.plan.kind}`;
  if (!isAutoKind(kind)) return null;
  if (s.plan.kind === 'home' && !s.plan.entities.every((e) => e.startsWith('light.'))) return null;
  return { kind, via: 'solve' };
}

/** May this kind act now? `today` is the local day (`localDayOf`). */
export function mayAuto(state: AutonomyState, kind: AutoKind, today: string, dayOf: (d: Date) => string): { ok: true } | { ok: false; why: string } {
  if (levelOf(state, kind) !== 'do') return { ok: false, why: `${AUTO_WORDS[kind].label.toLowerCase()} wait for a tap` };
  const acted = state.log.filter((e) => dayOf(new Date(e.at)) === today).length;
  if (acted >= AUTO_DAILY_CAP) return { ok: false, why: `${AUTO_DAILY_CAP} automatic acts already today` };
  return { ok: true };
}

export function withAuto(state: AutonomyState, entry: AutoLogEntry): AutonomyState {
  return { ...state, log: [...state.log.filter((e) => e.thoughtId !== entry.thoughtId), entry].slice(-LOG_KEEP) };
}

/**
 * He took an automatic act back. The second inside the window, counted from
 * when the kind was last set, puts the kind back to ask.
 */
export function withUndo(state: AutonomyState, thoughtId: string, now: Date): { state: AutonomyState; demoted: AutoKind | null } {
  const entry = state.log.find((e) => e.thoughtId === thoughtId);
  if (!entry || entry.undoneAt || entry.restoredAt) return { state, demoted: null };
  const log = state.log.map((e) => (e === entry ? { ...e, undoneAt: now.toISOString() } : e));
  const next: AutonomyState = { ...state, log };
  if (levelOf(next, entry.kind) !== 'do') return { state: next, demoted: null };
  const windowFrom = now.getTime() - DEMOTE_WINDOW_DAYS * DAY_MS;
  // Strictly after the level was set: the undos that moved it do not count again.
  const setAt = Date.parse(next.levels[entry.kind]?.at ?? '') || 0;
  const undone = log.filter((e) => e.kind === entry.kind && e.undoneAt && Date.parse(e.undoneAt) >= windowFrom && Date.parse(e.undoneAt) > setAt).length;
  if (undone < DEMOTE_UNDOS) return { state: next, demoted: null };
  return {
    state: { ...next, levels: { ...next.levels, [entry.kind]: { level: 'ask', by: 'ladder', at: now.toISOString() } }, taps: { ...next.taps, [entry.kind]: 0 } },
    demoted: entry.kind,
  };
}

/** Lights went back on because someone came home: recorded, not held against the kind. */
export function withRestore(state: AutonomyState, thoughtId: string, now: Date): AutonomyState {
  return { ...state, log: state.log.map((e) => (e.thoughtId === thoughtId && !e.undoneAt && !e.restoredAt ? { ...e, restoredAt: now.toISOString() } : e)) };
}

/** He pressed a step himself. Enough of those on a kind the LADDER put back move it forward. */
export function withTap(state: AutonomyState, kind: AutoKind, now: Date): { state: AutonomyState; promoted: boolean } {
  const cur = state.levels[kind];
  if (!cur || cur.level !== 'ask' || cur.by !== 'ladder') return { state, promoted: false };
  const taps = (state.taps[kind] ?? 0) + 1;
  if (taps < PROMOTE_TAPS) return { state: { ...state, taps: { ...state.taps, [kind]: taps } }, promoted: false };
  return {
    state: { ...state, levels: { ...state.levels, [kind]: { level: 'do', by: 'ladder', at: now.toISOString() } }, taps: { ...state.taps, [kind]: 0 } },
    promoted: true,
  };
}

/** His own setting, from the Solutions page. */
export function withLevel(state: AutonomyState, kind: AutoKind, level: Level, now: Date): AutonomyState {
  return { ...state, levels: { ...state.levels, [kind]: { level, by: 'owner', at: now.toISOString() } }, taps: { ...state.taps, [kind]: 0 } };
}

export interface LadderRow {
  kind: AutoKind;
  label: string;
  does: string;
  undo: string;
  level: Level;
  /** Why it is where it is, when that is not the default. */
  note: string | null;
  /** Automatic acts in the window, and how many he took back. */
  acted: number;
  undone: number;
}

export function ladderView(state: AutonomyState, now: Date): LadderRow[] {
  const since = now.getTime() - DEMOTE_WINDOW_DAYS * DAY_MS;
  return AUTO_KINDS.map((kind) => {
    const cur = state.levels[kind];
    const recent = state.log.filter((e) => e.kind === kind && Date.parse(e.at) >= since);
    const taps = state.taps[kind] ?? 0;
    const note = !cur
      ? null
      : cur.by === 'ladder' && cur.level === 'ask'
        ? `Put back to asking after ${DEMOTE_UNDOS} were undone. ${PROMOTE_TAPS - taps} more tap${PROMOTE_TAPS - taps === 1 ? '' : 's'} on one moves it forward again.`
        : cur.by === 'ladder'
          ? 'Moved forward again after you kept tapping it.'
          : cur.level === 'ask'
            ? 'You set this to ask.'
            : null;
    return { kind, ...AUTO_WORDS[kind], level: levelOf(state, kind), note, acted: recent.length, undone: recent.filter((e) => e.undoneAt).length };
  });
}
