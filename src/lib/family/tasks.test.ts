import { describe, expect, it } from 'vitest';
import {
  confirmedText,
  formatPence,
  listsFor,
  owedTotal,
  rewardLabel,
  toWire,
  transition,
  validateFields,
  validateReward,
  type TaskRecord,
} from './tasks';

const now = new Date('2026-09-28T12:00:00Z');
const parent = { email: 'parent@example.test', parent: true };
const kid = { email: 'kid@example.test', parent: false };
const other = { email: 'other@example.test', parent: false };

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Tidy room',
    notes: null,
    deadline: null,
    assigneeEmail: null,
    createdByEmail: parent.email,
    status: 'open',
    doneByEmail: null,
    doneAt: null,
    sentBackNote: null,
    sentBackAt: null,
    confirmedByEmail: null,
    confirmedAt: null,
    rewardKind: null,
    rewardPence: null,
    rewardNote: null,
    rewardPaidAt: null,
    rewardPaidByEmail: null,
    createdAt: new Date('2026-09-20T12:00:00Z'),
    updatedAt: new Date('2026-09-20T12:00:00Z'),
    ...over,
  };
}

describe('validateReward', () => {
  it('no reward is fine', () => {
    expect(validateReward(undefined)).toEqual({ ok: true, value: null });
    expect(validateReward(null)).toEqual({ ok: true, value: null });
  });

  it('cash REQUIRES a positive amount', () => {
    expect(validateReward({ kind: 'cash' }).ok).toBe(false);
    expect(validateReward({ kind: 'cash', pence: 0 }).ok).toBe(false);
    expect(validateReward({ kind: 'cash', pence: 500 })).toEqual({ ok: true, value: { kind: 'cash', pence: 500, note: null } });
  });

  it('a category takes an optional value and/or note', () => {
    expect(validateReward({ kind: 'day_out' })).toEqual({ ok: true, value: { kind: 'day_out', pence: null, note: null } });
    expect(validateReward({ kind: 'other', note: '  Cinema ' })).toEqual({ ok: true, value: { kind: 'other', pence: null, note: 'Cinema' } });
    expect(validateReward({ kind: 'lunch_out', pence: 1200 }).ok).toBe(true);
  });

  it('refuses a bad kind, fractional or out-of-range pence, and a long note', () => {
    expect(validateReward({ kind: 'sweets' }).ok).toBe(false);
    expect(validateReward({ kind: 'cash', pence: 1.5 }).ok).toBe(false);
    expect(validateReward({ kind: 'cash', pence: -1 }).ok).toBe(false);
    expect(validateReward({ kind: 'cash', pence: 100_001 }).ok).toBe(false);
    expect(validateReward({ kind: 'other', note: 'x'.repeat(81) }).ok).toBe(false);
  });
});

describe('validateFields', () => {
  const resolve = (id: string) => (id === 'f_kid' ? kid.email : null);

  it('needs a title on create, 1–120 characters', () => {
    expect(validateFields({}, resolve, 'create').ok).toBe(false);
    expect(validateFields({ title: '   ' }, resolve, 'create').ok).toBe(false);
    expect(validateFields({ title: 'x'.repeat(121) }, resolve, 'create').ok).toBe(false);
    expect(validateFields({ title: ' Bins ' }, resolve, 'create')).toEqual({ ok: true, value: { title: 'Bins' } });
  });

  it('maps an assignee id to their email, and refuses a stranger', () => {
    expect(validateFields({ title: 'Bins', assigneeId: 'f_kid' }, resolve, 'create')).toEqual({
      ok: true,
      value: { title: 'Bins', assigneeEmail: kid.email },
    });
    expect(validateFields({ title: 'Bins', assigneeId: 'f_nobody' }, resolve, 'create').ok).toBe(false);
  });

  it('checks the deadline is a real date, and notes ≤ 1000', () => {
    expect(validateFields({ title: 'a', deadline: '2026-02-30' }, resolve, 'create').ok).toBe(false);
    expect(validateFields({ title: 'a', deadline: '2026-10-01' }, resolve, 'create').ok).toBe(true);
    expect(validateFields({ title: 'a', notes: 'x'.repeat(1001) }, resolve, 'create').ok).toBe(false);
  });

  it('on edit, changes only what is present, and null clears', () => {
    expect(validateFields({ deadline: null, reward: null }, resolve, 'edit')).toEqual({
      ok: true,
      value: { deadline: null, rewardKind: null, rewardPence: null, rewardNote: null },
    });
  });
});

describe('transition — the state machine and who may', () => {
  it('anyone marks an open task done; it clears a sent-back note', () => {
    const r = transition(task({ sentBackNote: 'Not quite' }), 'done', kid, now);
    expect(r).toMatchObject({ ok: true, value: { from: 'open', patch: { status: 'done', doneByEmail: kid.email, sentBackNote: null } } });
    expect(transition(task({ status: 'done' }), 'done', kid, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('undo: the doer or a parent, from done', () => {
    const done = task({ status: 'done', doneByEmail: kid.email });
    expect(transition(done, 'undo', kid, now).ok).toBe(true);
    expect(transition(done, 'undo', parent, now).ok).toBe(true);
    expect(transition(done, 'undo', other, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition(task(), 'undo', kid, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('confirm: parent only, from done', () => {
    const done = task({ status: 'done', doneByEmail: kid.email });
    expect(transition(done, 'confirm', kid, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition(done, 'confirm', parent, now)).toMatchObject({
      ok: true,
      value: { from: 'done', patch: { status: 'confirmed', confirmedByEmail: parent.email } },
    });
    expect(transition(task(), 'confirm', parent, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('send back: parent only, needs a note, returns to open', () => {
    const done = task({ status: 'done', doneByEmail: kid.email });
    expect(transition(done, 'send_back', kid, now, { note: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(transition(done, 'send_back', parent, now, { note: '  ' })).toMatchObject({ ok: false, status: 400 });
    expect(transition(done, 'send_back', parent, now, { note: 'Under the bed too' })).toMatchObject({
      ok: true,
      value: { from: 'done', patch: { status: 'open', sentBackNote: 'Under the bed too', doneByEmail: null } },
    });
  });

  it('paid: parent only, a confirmed unpaid reward', () => {
    const owed = task({ status: 'confirmed', rewardKind: 'cash', rewardPence: 500 });
    expect(transition(owed, 'paid', kid, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition(owed, 'paid', parent, now)).toMatchObject({ ok: true, value: { from: 'confirmed', patch: { rewardPaidAt: now } } });
    expect(transition(task({ status: 'confirmed' }), 'paid', parent, now)).toMatchObject({ ok: false, status: 409 });
    expect(transition({ ...owed, rewardPaidAt: now }, 'paid', parent, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('edit: creator or parent, only while open', () => {
    const mine = task({ createdByEmail: kid.email });
    expect(transition(mine, 'edit', kid, now).ok).toBe(true);
    expect(transition(mine, 'edit', parent, now).ok).toBe(true);
    expect(transition(mine, 'edit', other, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition({ ...mine, status: 'done' }, 'edit', kid, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('delete: creator or parent, soft; a deleted task is 404', () => {
    const mine = task({ createdByEmail: kid.email });
    expect(transition(mine, 'delete', kid, now)).toMatchObject({ ok: true, value: { patch: { status: 'deleted' } } });
    expect(transition(mine, 'delete', other, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition({ ...mine, status: 'deleted' }, 'done', kid, now)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('listsFor and owed', () => {
  const rows = [
    task({ id: 'late', deadline: '2026-10-05' }),
    task({ id: 'none', createdAt: new Date('2026-09-01T00:00:00Z') }),
    task({ id: 'soon', deadline: '2026-09-29', status: 'done', doneByEmail: other.email }),
    task({ id: 'kid-paid', status: 'confirmed', doneByEmail: kid.email, confirmedAt: new Date('2026-09-27T00:00:00Z'), rewardKind: 'cash', rewardPence: 500, rewardPaidAt: now }),
    task({ id: 'kid-owed', status: 'confirmed', doneByEmail: kid.email, confirmedAt: new Date('2026-09-26T00:00:00Z'), rewardKind: 'cash', rewardPence: 500 }),
    task({ id: 'kid-day', status: 'confirmed', doneByEmail: kid.email, confirmedAt: new Date('2026-09-25T00:00:00Z'), rewardKind: 'day_out' }),
    task({ id: 'other-owed', status: 'confirmed', doneByEmail: other.email, confirmedAt: new Date('2026-09-24T00:00:00Z'), rewardKind: 'lunch_out', rewardPence: 1000 }),
    task({ id: 'old', status: 'confirmed', doneByEmail: kid.email, confirmedAt: new Date('2026-05-01T00:00:00Z') }),
    task({ id: 'gone', status: 'deleted' }),
  ];

  it('open: everyone’s open and done, deadline soonest, none last, then oldest', () => {
    expect(listsFor(rows, kid, now).open.map((t) => t.id)).toEqual(['soon', 'late', 'none']);
  });

  it('a member sees their own completed and owed', () => {
    const l = listsFor(rows, kid, now);
    expect(l.completed.map((t) => t.id)).toEqual(['kid-paid', 'kid-owed', 'kid-day']);
    expect(l.owed.items.map((t) => t.id)).toEqual(['kid-day', 'kid-owed']);
    expect(l.owed.totalPence).toBe(500);
  });

  it('a parent sees everyone’s; completed stops at 90 days', () => {
    const l = listsFor(rows, parent, now);
    expect(l.completed.map((t) => t.id)).toEqual(['kid-paid', 'kid-owed', 'kid-day', 'other-owed']);
    expect(l.owed.totalPence).toBe(1500);
    expect(owedTotal([])).toBe(0);
  });
});

describe('wire and words', () => {
  it('carries people as ids, never emails', () => {
    const w = toWire(task({ assigneeEmail: kid.email, rewardKind: 'cash', rewardPence: 500 }), (e) => `f_${e.split('@')[0]}`);
    expect(w).toMatchObject({ assignee: 'f_kid', createdBy: 'f_parent', doneBy: null, reward: { kind: 'cash', pence: 500, note: null, paidAt: null } });
    expect(JSON.stringify(w)).not.toContain('@');
  });

  it('formats money and rewards', () => {
    expect(formatPence(500)).toBe('£5');
    expect(formatPence(550)).toBe('£5.50');
    expect(formatPence(100000)).toBe('£1,000');
    expect(rewardLabel({ rewardKind: 'game_time', rewardPence: null, rewardNote: null })).toBe('Game time');
    expect(rewardLabel({ rewardKind: 'other', rewardPence: 300, rewardNote: 'Cinema' })).toBe('Cinema (£3)');
    expect(confirmedText({ title: 'Bins', rewardKind: 'cash', rewardPence: 500, rewardNote: null })).toBe('Confirmed: Bins — £5 owed');
    expect(confirmedText({ title: 'Bins', rewardKind: null, rewardPence: null, rewardNote: null })).toBe('Confirmed: Bins');
  });
});
