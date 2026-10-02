import { describe, expect, it } from 'vitest';
import { beforeTimes, checkPlan, isAllDay, londonToUtc, looksSchedulable, movedTimes, noteAct, noteNamesDate, readStored, storeAction, toCreateArgs, whenWords } from './plan';
import { addressOf } from './act.server';

const bike = 'Bike dispatch is late\nThe shop said it would ship within a week.\n\nNext: Put 10 October in the diary to chase the bike dispatch.';
const today = '2026-10-02';

describe('noteNamesDate', () => {
  it('finds the day in the forms a note writes it', () => {
    expect(noteNamesDate(bike, '2026-10-10', today)).toBe(true);
    expect(noteNamesDate('chase on October 10th', '2026-10-10', today)).toBe(true);
    expect(noteNamesDate('chase on 10th Oct', '2026-10-10', today)).toBe(true);
    expect(noteNamesDate('due 2026-10-10', '2026-10-10', today)).toBe(true);
    expect(noteNamesDate('do it tomorrow', '2026-10-03', today)).toBe(true);
  });

  it('does not take a different day for it', () => {
    expect(noteNamesDate(bike, '2026-10-11', today)).toBe(false);
    expect(noteNamesDate('100 October', '2026-10-10', today)).toBe(false);
    expect(noteNamesDate('do it tomorrow', '2026-10-04', today)).toBe(false);
  });
});

describe('checkPlan', () => {
  const plan = { kind: 'calendar_event', title: 'Chase the bike dispatch', date: '2026-10-10', time: null };

  it('passes the owner’s example', () => {
    expect(checkPlan(plan, { noteText: bike, today })).toEqual({ ok: true, plan: { ...plan, time: null } });
  });

  it('refuses a date the note never named', () => {
    const r = checkPlan({ ...plan, date: '2026-10-12' }, { noteText: bike, today });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('will not guess') });
  });

  it('refuses a past date, a far one, a bad one and an unknown kind', () => {
    expect(checkPlan({ ...plan, date: '2026-09-30' }, { noteText: 'by 30 September', today }).ok).toBe(false);
    expect(checkPlan({ ...plan, date: '2027-12-10' }, { noteText: 'on 10 December 2027 (2027-12-10)', today }).ok).toBe(false);
    expect(checkPlan({ ...plan, date: '2026-02-30' }, { noteText: bike, today }).ok).toBe(false);
    expect(checkPlan({ ...plan, kind: 'send_email' }, { noteText: bike, today })).toMatchObject({ ok: false, reason: expect.stringContaining('not one it can carry out') });
    expect(checkPlan({ ...plan, kind: 'make_payment' }, { noteText: bike, today }).ok).toBe(false);
    expect(checkPlan({ ...plan, title: 'x' }, { noteText: bike, today }).ok).toBe(false);
  });

  it('keeps a well-formed time and drops a malformed one', () => {
    expect(checkPlan({ ...plan, time: '09:30' }, { noteText: bike, today })).toMatchObject({ ok: true, plan: { time: '09:30' } });
    expect(checkPlan({ ...plan, time: '9.30am' }, { noteText: bike, today })).toMatchObject({ ok: true, plan: { time: null } });
  });
});

describe('looksSchedulable', () => {
  it('offers the button only for a step it could put in the diary', () => {
    expect(looksSchedulable('Put 10 October in the diary to chase the bike dispatch.')).toBe(true);
    expect(looksSchedulable('Set a reminder for the MOT.')).toBe(true);
    expect(looksSchedulable('Cancel the one used least before it renews next month.')).toBe(false);
    expect(looksSchedulable(null)).toBe(false);
  });
});

describe('the calendar write', () => {
  it('an all-day entry by default', () => {
    expect(toCreateArgs({ kind: 'calendar_event', title: 'Chase', date: '2026-10-10', time: null }, 'Home', 'n')).toEqual({
      calendar: 'Home', title: 'Chase', notes: 'n', allDayStart: '2026-10-10', allDayEnd: '2026-10-10',
    });
  });

  it('a timed slot in London time, either side of the clock change', () => {
    expect(londonToUtc('2026-10-10', '09:00')).toBe('2026-10-10T08:00:00.000Z'); // BST
    expect(londonToUtc('2026-11-10', '09:00')).toBe('2026-11-10T09:00:00.000Z'); // GMT
    const args = toCreateArgs({ kind: 'calendar_event', title: 'Chase', date: '2026-10-10', time: '09:00' }, 'Home', 'n');
    expect(args).toMatchObject({ start: '2026-10-10T08:00:00.000Z', end: '2026-10-10T08:30:00.000Z' });
  });

  it('says when in words', () => {
    expect(whenWords({ date: '2026-10-10', time: null })).toBe('Sat 10 Oct');
    expect(whenWords({ date: '2026-10-10', time: '09:00' })).toBe('Sat 10 Oct, 09:00');
  });
});

describe('noteAct', () => {
  const plan = { kind: 'calendar_event' as const, title: 'Chase the bike dispatch', date: '2026-10-10', time: null };

  it('ready, done and undone, from what is stored', () => {
    const ready = [storeAction(plan, null)];
    expect(noteAct(ready, null)).toMatchObject({ status: 'ready', label: 'Add “Chase the bike dispatch” to your diary on Sat 10 Oct' });
    const done = [storeAction(plan, 'Home', { at: 'x', calendar: 'Home', uid: 'u', eventId: null, undoneAt: null })];
    expect(noteAct(done, null)).toMatchObject({ status: 'done', label: 'Added “Chase the bike dispatch” to your Home calendar on Sat 10 Oct' });
    const undone = [storeAction(plan, 'Home', { at: 'x', calendar: 'Home', uid: 'u', eventId: null, undoneAt: 'y' })];
    expect(noteAct(undone, null)?.status).toBe('undone');
  });

  it('open when there is no plan but the step is diary-shaped; nothing otherwise', () => {
    expect(noteAct([], 'Put 10 October in the diary.')?.status).toBe('open');
    expect(noteAct([], 'Cancel the subscription.')).toBeNull();
    expect(readStored([{ kind: 'calendar_event', label: 'x', payload: 'not json' }])).toBeNull();
  });
});

describe('reminder', () => {
  it('takes a reminder the note dates, at 09:00 unless it names a time', () => {
    const r = checkPlan({ kind: 'reminder', text: 'Chase the bike dispatch', date: '2026-10-10', time: null }, { noteText: bike, today });
    expect(r).toMatchObject({ ok: true, plan: { kind: 'reminder', time: null } });
    if (r.ok) expect(storeAction(r.plan, null).label).toBe('Remind you on Sat 10 Oct, 09:00: “Chase the bike dispatch”');
    expect(checkPlan({ kind: 'reminder', text: 'Chase', date: '2026-10-11', time: null }, { noteText: bike, today }).ok).toBe(false);
  });

  it('cannot be undone once it has fired', () => {
    const plan = { kind: 'reminder' as const, text: 'Chase', date: '2026-10-10', time: null };
    const fired = [storeAction(plan, null, { at: 'x', calendar: '', uid: '', eventId: null, undoneAt: null, callback: 'c', fireAt: '2000-01-01T09:00:00Z' })];
    expect(noteAct(fired, null)).toMatchObject({ status: 'done', undoable: false });
    const pending = [storeAction(plan, null, { at: 'x', calendar: '', uid: '', eventId: null, undoneAt: null, callback: 'c', fireAt: '2999-01-01T09:00:00Z' })];
    expect(noteAct(pending, null)).toMatchObject({ status: 'done', undoable: true, label: expect.stringContaining('It will remind you') });
  });
});

describe('calendar_move', () => {
  const clash = 'The dentist on 14 October clashes with the school run.\n\nNext: Move the dentist to 16 October.';

  it('moves an entry the note names, between days the note names', () => {
    expect(checkPlan({ kind: 'calendar_move', event: 'Dentist', from: '2026-10-14', to: '2026-10-16', time: null }, { noteText: clash, today }))
      .toMatchObject({ ok: true, plan: { event: 'Dentist', from: '2026-10-14', to: '2026-10-16' } });
    expect(checkPlan({ kind: 'calendar_move', event: 'Haircut', from: '2026-10-14', to: '2026-10-16', time: null }, { noteText: clash, today }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('does not name') });
    expect(checkPlan({ kind: 'calendar_move', event: 'Dentist', from: '2026-10-14', to: '2026-10-17', time: null }, { noteText: clash, today }).ok).toBe(false);
  });

  it('keeps the time of day and length across the clock change, and an all-day span', () => {
    // 09:00 BST on 14 Oct → 09:00 GMT on 27 Oct.
    const timed = movedTimes({ start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T08:45:00.000Z', allDay: false }, { to: '2026-10-27', time: null });
    expect(timed).toEqual({ allDay: false, start: '2026-10-27T09:00:00.000Z', end: '2026-10-27T09:45:00.000Z' });
    expect(movedTimes({ start: '2026-10-13T23:00:00.000Z', end: '2026-10-15T23:00:00.000Z', allDay: true }, { to: '2026-10-20', time: null }))
      .toEqual({ allDay: true, start: '2026-10-20', end: '2026-10-21' });
  });

  it('remembers where an entry was, all-day or timed', () => {
    expect(isAllDay({ start: '2026-10-13T23:00:00.000Z', end: '2026-10-14T23:00:00.000Z' })).toBe(true);
    expect(beforeTimes({ start: '2026-10-13T23:00:00.000Z', end: '2026-10-14T23:00:00.000Z' })).toEqual({ allDay: true, start: '2026-10-14', end: '2026-10-14' });
    expect(beforeTimes({ start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T08:45:00.000Z' })).toEqual({ allDay: false, start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T08:45:00.000Z' });
  });
});

describe('email_draft', () => {
  const evidence = '2026-09-26 from bikeshop.co.uk (order): Your order is confirmed';
  const draft = { kind: 'email_draft', domain: 'bikeshop.co.uk', subject: 'Where is my bike?', body: 'Hello, the order from 26 September has not been dispatched yet. Could you confirm when it will ship? Thanks, John' };

  it('writes only to a sender the note\'s sources name', () => {
    expect(checkPlan(draft, { noteText: bike, today, evidenceText: evidence })).toMatchObject({ ok: true });
    expect(checkPlan({ ...draft, domain: 'elsewhere.com' }, { noteText: bike, today, evidenceText: evidence }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('will not write to them') });
    expect(checkPlan({ ...draft, domain: 'bikeshop.co.uk', subject: 'x' }, { noteText: bike, today, evidenceText: evidence }).ok).toBe(false);
  });

  it('never lets a subject carry a line break into the headers', () => {
    const r = checkPlan({ ...draft, subject: 'Hello\r\nBcc: someone@else.com' }, { noteText: bike, today, evidenceText: evidence });
    expect(r.ok && r.plan.kind === 'email_draft' && /[\r\n]/.test(r.plan.subject)).toBe(false);
  });

  it('reads the address out of a From header', () => {
    expect(addressOf('Bike Shop <Orders@BikeShop.co.uk>')).toBe('orders@bikeshop.co.uk');
    expect(addressOf('orders@bikeshop.co.uk')).toBe('orders@bikeshop.co.uk');
  });

  it('shows the draft to read before it is sent, and sent cannot be undone', () => {
    const plan = { kind: 'email_draft' as const, domain: 'bikeshop.co.uk', subject: 'Where is my bike?', body: 'Hello' };
    const d = { id: 'd1', messageId: 'm1', threadId: 't1', to: 'orders@bikeshop.co.uk', subject: 'Re: Your order', body: 'Hello', accountEmail: 'me@example.com' };
    const drafted = noteAct([storeAction(plan, null, { at: 'x', calendar: '', uid: '', eventId: null, undoneAt: null, draft: d, sentAt: null })], null);
    expect(drafted).toMatchObject({ status: 'done', draft: { to: 'orders@bikeshop.co.uk', gmailUrl: expect.stringContaining('compose=m1') } });
    const sent = noteAct([storeAction(plan, null, { at: 'x', calendar: '', uid: '', eventId: null, undoneAt: null, draft: d, sentAt: 'y' })], null);
    expect(sent).toMatchObject({ status: 'sent', undoable: false, label: 'Sent to orders@bikeshop.co.uk' });
  });

  it('offers the button for a chase or reply step', () => {
    expect(looksSchedulable('Email the shop to chase the dispatch.')).toBe(true);
  });
});
