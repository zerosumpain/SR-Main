// The family task list — the pure half: input validation, the reward rule,
// the state machine with who may do what, the lists each person sees, what
// is owed, and the words of every push. No database, no clock of its own.
//
// Spec: docs/superpowers/specs/2026-09-28-family-steps-and-tasks.md

export const REWARD_KINDS = ['cash', 'day_out', 'game_time', 'lunch_out', 'other'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export type TaskStatus = 'open' | 'done' | 'confirmed' | 'deleted';

export const TITLE_MAX = 120;
export const NOTES_MAX = 1000;
export const REWARD_NOTE_MAX = 80;
export const SEND_BACK_NOTE_MAX = 1000;
export const PENCE_MAX = 100_000;
/** A parent sees this far back in Completed; a member, their own this far back. */
export const COMPLETED_DAYS = 90;

/** A task as stored (the columns of `family_task`, camel-cased). */
export interface TaskRecord {
  id: string;
  title: string;
  notes: string | null;
  deadline: string | null;
  assigneeEmail: string | null;
  createdByEmail: string;
  status: string;
  doneByEmail: string | null;
  doneAt: Date | null;
  sentBackNote: string | null;
  sentBackAt: Date | null;
  confirmedByEmail: string | null;
  confirmedAt: Date | null;
  rewardKind: string | null;
  rewardPence: number | null;
  rewardNote: string | null;
  rewardPaidAt: Date | null;
  rewardPaidByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Reward {
  kind: RewardKind;
  pence: number | null;
  note: string | null;
}

export interface Actor {
  email: string;
  parent: boolean;
}

export type Invalid = { ok: false; status: 400 | 403 | 404 | 409; error: string };
export type Valid<T> = { ok: true; value: T };

const bad = (error: string): Invalid => ({ ok: false, status: 400, error });

export function isRewardKind(v: unknown): v is RewardKind {
  return typeof v === 'string' && (REWARD_KINDS as readonly string[]).includes(v);
}

/** A trimmed string, null for empty/absent, or undefined when it is not a string at all. */
function text(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : null;
}

/**
 * A reward from a request body. Null/absent = no reward. Cash REQUIRES a
 * positive £ value; every other kind takes an optional value and/or note. PURE.
 */
export function validateReward(raw: unknown): Valid<Reward | null> | Invalid {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad('A reward must be an object.');
  const r = raw as Record<string, unknown>;
  if (!isRewardKind(r.kind)) return bad('Pick a reward: cash, day out, game time, lunch out or other.');
  let pence: number | null = null;
  if (r.pence !== null && r.pence !== undefined) {
    if (typeof r.pence !== 'number' || !Number.isInteger(r.pence) || r.pence < 0 || r.pence > PENCE_MAX) {
      return bad(`A reward is a whole number of pence, up to £${PENCE_MAX / 100}.`);
    }
    pence = r.pence;
  }
  if (r.kind === 'cash' && !(pence !== null && pence > 0)) return bad('A cash reward needs an amount.');
  const note = text(r.note);
  if (note === undefined) return bad('A reward note must be text.');
  if (note && note.length > REWARD_NOTE_MAX) return bad(`A reward note is at most ${REWARD_NOTE_MAX} characters.`);
  return { ok: true, value: { kind: r.kind, pence, note } };
}

/** YYYY-MM-DD that is a real calendar day. */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The editable fields, as columns. A key absent = unchanged (on an edit). */
export interface TaskFields {
  title?: string;
  notes?: string | null;
  deadline?: string | null;
  assigneeEmail?: string | null;
  rewardKind?: RewardKind | null;
  rewardPence?: number | null;
  rewardNote?: string | null;
}

/**
 * The fields of a create or an edit, validated. `resolve` turns a person id
 * into an email, or null when that id is nobody in the family. On a create
 * the title is required; on an edit only what is present changes. PURE.
 */
export function validateFields(
  body: Record<string, unknown>,
  resolve: (personId: string) => string | null,
  mode: 'create' | 'edit',
): Valid<TaskFields> | Invalid {
  const out: TaskFields = {};
  if (mode === 'create' || 'title' in body) {
    const title = text(body.title);
    if (!title) return bad('A task needs a title.');
    if (title.length > TITLE_MAX) return bad(`A title is at most ${TITLE_MAX} characters.`);
    out.title = title;
  }
  if ('notes' in body) {
    const notes = text(body.notes);
    if (notes === undefined) return bad('Notes must be text.');
    if (notes && notes.length > NOTES_MAX) return bad(`Notes are at most ${NOTES_MAX} characters.`);
    out.notes = notes;
  }
  if ('deadline' in body) {
    if (body.deadline === null || body.deadline === undefined || body.deadline === '') out.deadline = null;
    else if (isDay(body.deadline)) out.deadline = body.deadline;
    else return bad('A deadline is a date, YYYY-MM-DD.');
  }
  if ('assigneeId' in body) {
    if (body.assigneeId === null || body.assigneeId === undefined || body.assigneeId === '') out.assigneeEmail = null;
    else {
      const email = typeof body.assigneeId === 'string' ? resolve(body.assigneeId) : null;
      if (!email) return bad('That person is not in the family.');
      out.assigneeEmail = email;
    }
  }
  if ('reward' in body) {
    const reward = validateReward(body.reward);
    if (!reward.ok) return reward;
    out.rewardKind = reward.value?.kind ?? null;
    out.rewardPence = reward.value?.pence ?? null;
    out.rewardNote = reward.value?.note ?? null;
  }
  return { ok: true, value: out };
}

export const ACTIONS = ['done', 'undo', 'confirm', 'send_back', 'paid', 'edit', 'delete'] as const;
export type TaskAction = (typeof ACTIONS)[number];

export function isAction(v: unknown): v is TaskAction {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

/** What an action writes, and the status the row must still hold for it to apply. */
export interface Transition {
  from: TaskStatus;
  patch: Partial<TaskRecord>;
}

const forbidden = (error: string): Invalid => ({ ok: false, status: 403, error });
const conflict = (error: string): Invalid => ({ ok: false, status: 409, error });

/**
 * One action on one task by one person: who may, from which state, and what
 * changes. Order of refusal: a parent-only action refuses a non-parent first
 * (403), then a wrong state is 409, then a doer/creator rule is 403. A deleted
 * task is 404 — it is gone as far as anyone asking is concerned. PURE.
 */
export function transition(
  task: Pick<TaskRecord, 'status' | 'doneByEmail' | 'createdByEmail' | 'rewardKind' | 'rewardPaidAt'>,
  action: TaskAction,
  actor: Actor,
  now: Date,
  extra: { note?: unknown; fields?: TaskFields } = {},
): Valid<Transition> | Invalid {
  if (task.status === 'deleted') return { ok: false, status: 404, error: 'No such task.' };
  const isCreator = task.createdByEmail === actor.email;
  switch (action) {
    case 'done':
      if (task.status !== 'open') return conflict('Only an open task can be marked done.');
      return {
        ok: true,
        value: { from: 'open', patch: { status: 'done', doneByEmail: actor.email, doneAt: now, sentBackNote: null, sentBackAt: null } },
      };
    case 'undo':
      if (task.status !== 'done') return conflict('Only a done task can be undone.');
      if (!actor.parent && task.doneByEmail !== actor.email) return forbidden('Only whoever did it, or a parent, can undo it.');
      return { ok: true, value: { from: 'done', patch: { status: 'open', doneByEmail: null, doneAt: null } } };
    case 'confirm':
      if (!actor.parent) return forbidden('Only a parent can confirm a task.');
      if (task.status !== 'done') return conflict('Only a done task can be confirmed.');
      return { ok: true, value: { from: 'done', patch: { status: 'confirmed', confirmedByEmail: actor.email, confirmedAt: now } } };
    case 'send_back': {
      if (!actor.parent) return forbidden('Only a parent can send a task back.');
      if (task.status !== 'done') return conflict('Only a done task can be sent back.');
      const note = text(extra.note);
      if (!note) return bad('Say why it is going back.');
      if (note.length > SEND_BACK_NOTE_MAX) return bad(`A note is at most ${SEND_BACK_NOTE_MAX} characters.`);
      // Back to open as if never done; the caller pushes the doer from the row it read.
      return {
        ok: true,
        value: { from: 'done', patch: { status: 'open', sentBackNote: note, sentBackAt: now, doneByEmail: null, doneAt: null } },
      };
    }
    case 'paid':
      if (!actor.parent) return forbidden('Only a parent can mark a reward paid.');
      if (task.status !== 'confirmed' || !task.rewardKind || task.rewardPaidAt) {
        return conflict('Only a confirmed, unpaid reward can be marked paid.');
      }
      return { ok: true, value: { from: 'confirmed', patch: { rewardPaidAt: now, rewardPaidByEmail: actor.email } } };
    case 'edit':
      if (task.status !== 'open') return conflict('Only an open task can be edited.');
      if (!actor.parent && !isCreator) return forbidden('Only whoever added it, or a parent, can edit it.');
      return { ok: true, value: { from: 'open', patch: { ...(extra.fields ?? {}) } } };
    case 'delete':
      if (!actor.parent && !isCreator) return forbidden('Only whoever added it, or a parent, can delete it.');
      return { ok: true, value: { from: task.status as TaskStatus, patch: { status: 'deleted' } } };
  }
}

/** A task as the phone reads it: people by id, never by email. */
export interface TaskWire {
  id: string;
  title: string;
  notes: string | null;
  deadline: string | null;
  assignee: string | null;
  createdBy: string;
  status: string;
  doneBy: string | null;
  doneAt: string | null;
  sentBackNote: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  reward: { kind: string; pence: number | null; note: string | null; paidAt: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toWire(t: TaskRecord, idOf: (email: string) => string): TaskWire {
  const person = (e: string | null) => (e ? idOf(e) : null);
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    deadline: t.deadline,
    assignee: person(t.assigneeEmail),
    createdBy: idOf(t.createdByEmail),
    status: t.status,
    doneBy: person(t.doneByEmail),
    doneAt: iso(t.doneAt),
    sentBackNote: t.sentBackNote,
    confirmedBy: person(t.confirmedByEmail),
    confirmedAt: iso(t.confirmedAt),
    reward: t.rewardKind
      ? { kind: t.rewardKind, pence: t.rewardPence, note: t.rewardNote, paidAt: iso(t.rewardPaidAt) }
      : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export interface TaskLists<T> {
  open: T[];
  completed: T[];
  owed: { totalPence: number; items: T[] };
}

/** Confirmed, carries a reward, not yet paid. */
export function isOwed(t: Pick<TaskRecord, 'status' | 'rewardKind' | 'rewardPaidAt'>): boolean {
  return t.status === 'confirmed' && !!t.rewardKind && !t.rewardPaidAt;
}

/** The £ of every owed item; category rewards with no value count nothing. */
export function owedTotal(items: ReadonlyArray<Pick<TaskRecord, 'rewardPence'>>): number {
  return items.reduce((sum, t) => sum + (t.rewardPence ?? 0), 0);
}

/**
 * The three lists one person sees. Open is everyone's (a family list);
 * Completed and Owed are the caller's own for a member and everyone's for a
 * parent. Open: deadline soonest first, no deadline last, then oldest. PURE.
 */
export function listsFor(rows: readonly TaskRecord[], me: Actor, now: Date): TaskLists<TaskRecord> {
  const mine = (t: TaskRecord) => me.parent || t.doneByEmail === me.email;
  const since = now.getTime() - COMPLETED_DAYS * 86_400_000;
  const open = rows
    .filter((t) => t.status === 'open' || t.status === 'done')
    .sort((a, b) => {
      if (a.deadline !== b.deadline) {
        if (a.deadline === null) return 1;
        if (b.deadline === null) return -1;
        return a.deadline < b.deadline ? -1 : 1;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  const completed = rows
    .filter((t) => t.status === 'confirmed' && mine(t) && (t.confirmedAt?.getTime() ?? 0) >= since)
    .sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0));
  const owedItems = rows
    .filter((t) => isOwed(t) && mine(t))
    .sort((a, b) => (a.confirmedAt?.getTime() ?? 0) - (b.confirmedAt?.getTime() ?? 0));
  return { open, completed, owed: { totalPence: owedTotal(owedItems), items: owedItems } };
}

/** £5, £5.50, £1,000. */
export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const KIND_LABEL: Record<RewardKind, string> = {
  cash: 'Cash',
  day_out: 'Day out',
  game_time: 'Game time',
  lunch_out: 'Lunch out',
  other: 'Reward',
};

/** "£5", "Day out", "Game time (£3)", "Cinema" (an other with a note). */
export function rewardLabel(r: Pick<TaskRecord, 'rewardKind' | 'rewardPence' | 'rewardNote'>): string | null {
  if (!isRewardKind(r.rewardKind)) return null;
  if (r.rewardKind === 'cash') return r.rewardPence ? formatPence(r.rewardPence) : 'Cash';
  const base = r.rewardKind === 'other' && r.rewardNote ? r.rewardNote : KIND_LABEL[r.rewardKind];
  return r.rewardPence ? `${base} (${formatPence(r.rewardPence)})` : base;
}

export function doneText(name: string, title: string): string {
  return `${name} finished: ${title}`;
}

export function confirmedText(t: Pick<TaskRecord, 'title' | 'rewardKind' | 'rewardPence' | 'rewardNote'>): string {
  const reward = rewardLabel(t);
  return reward ? `Confirmed: ${t.title} — ${reward} owed` : `Confirmed: ${t.title}`;
}

export function sentBackText(title: string, note: string): string {
  return `Sent back: ${title} — ${note}`;
}

export function assignedText(byName: string, title: string): string {
  return `${byName} gave you a task: ${title}`;
}
