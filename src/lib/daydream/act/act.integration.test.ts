import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

// The calendar is the only thing faked: every write to the thought row, the
// feedback and the setting is real, against the isolated local database.
const mock = vi.hoisted(() => ({ tool: vi.fn(), draft: vi.fn(), gmail: {
  listMessages: vi.fn(), fetchMessage: vi.fn(), createDraft: vi.fn(), sendDraft: vi.fn(), deleteDraft: vi.fn(),
} }));
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
vi.mock('$lib/workflows/site-tools/registry', () => ({ executeTool: mock.tool }));
vi.mock('./plan.server', () => ({ draftPlan: mock.draft }));
// Gmail's API is faked; the account row it is called with is real.
vi.mock('$lib/workflows/gmail/service', () => ({ gmailService: mock.gmail }));
import { db } from '$lib/db';
import { ACT_CALENDAR_KEY, doIt, reminderName, sendIt, undoIt } from './act.server';
import { storeAction } from './plan';
import { persistCandidates } from '../thought-store';
import { setSetting } from '$lib/server/models/settings';

const database = process.env.DATABASE_URL ?? '';
const enabled = /(?:127\.0\.0\.1|localhost):15445\//.test(database);
const ids: string[] = [];
const NOW = new Date('2026-10-02T09:00:00Z');
const PLAN = { kind: 'calendar_event' as const, title: 'Chase the bike dispatch', date: '2026-10-10', time: null };
const MAILBOX = `uiseed-act-${randomUUID().slice(0, 8)}@example.invalid`;

async function note(actions: unknown[] = [], narrative = 'The shop promised dispatch within a week.\n\nNext: Put 10 October in the diary to chase the bike dispatch.',
  evidence: unknown[] = []) {
  const id = `uiseed-act-${randomUUID()}`;
  ids.push(id);
  await db.execute(sql`INSERT INTO daydream_thoughts(id,kind,title,explanation,narrative,dedupe_key,status,evidence,proposed_actions)
    VALUES (${id},'think_efficiency','Bike dispatch is overdue','Read mail facts.',
      ${narrative}, ${id},'delivered',${JSON.stringify(evidence)}::jsonb,${JSON.stringify(actions)}::jsonb)`);
  return id;
}
const row = async (id: string) =>
  (await db.execute(sql`SELECT status,feedback,proposed_actions FROM daydream_thoughts WHERE id=${id}`)).rows[0] as {
    status: string; feedback: string | null; proposed_actions: Array<Record<string, any>>;
  };

describe.skipIf(!enabled)('do it for me, against isolated local Postgres', () => {
  let previous: unknown = undefined;
  beforeEach(async () => {
    if (previous === undefined) {
      previous = (await db.execute(sql`SELECT value FROM app_settings WHERE key=${ACT_CALENDAR_KEY}`)).rows[0]?.value ?? null;
    }
    await setSetting(ACT_CALENDAR_KEY, ''); // '' reads as not chosen; null cannot be stored
    mock.tool.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'apple_calendar_list' && args.listCalendars) return { success: true, data: { calendars: [{ label: 'Home' }, { label: 'Family Calendar' }] } };
      if (name === 'apple_calendar_create') return { success: true, data: { id: 'uid-123', url: '', calendar: args.calendar } };
      if (name === 'apple_calendar_list') return { success: true, data: { events: [{ id: 'https://caldav.example/home/uid-123.ics', uid: 'uid-123' }] } };
      if (name === 'apple_calendar_delete') return { success: true, data: { deleted: true } };
      return { success: false, error: 'unexpected tool' };
    });
    mock.draft.mockReset().mockResolvedValue(PLAN);
    for (const f of Object.values(mock.gmail)) f.mockReset();
  });
  afterAll(async () => {
    for (const id of ids) await db.execute(sql`DELETE FROM daydream_thoughts WHERE id=${id}`);
    await db.execute(sql`DELETE FROM app_settings WHERE key=${ACT_CALENDAR_KEY}`);
    await db.execute(sql`DELETE FROM gmail_accounts WHERE email=${MAILBOX}`);
    if (previous != null) await db.execute(sql`INSERT INTO app_settings(key,value) VALUES (${ACT_CALENDAR_KEY},${JSON.stringify(previous)}::jsonb)`);
  });

  it('asks for a calendar once, then does it, marks it worth knowing, and a second tap does nothing more', async () => {
    const id = await note();
    const first = await doIt(id, NOW);
    expect(first).toMatchObject({ ok: false, needsCalendar: true, calendars: ['Home', 'Family Calendar'] });
    expect(mock.tool.mock.calls.some(([n]) => n === 'apple_calendar_create')).toBe(false);

    await setSetting(ACT_CALENDAR_KEY, 'Home');
    const done = await doIt(id, NOW);
    expect(done).toMatchObject({ ok: true, status: 'done', calendar: 'Home' });
    const create = mock.tool.mock.calls.find(([n]) => n === 'apple_calendar_create')!;
    expect(create[1]).toMatchObject({ calendar: 'Home', title: 'Chase the bike dispatch', allDayStart: '2026-10-10', allDayEnd: '2026-10-10' });
    expect(String(create[1].notes)).toContain(`/jkai/daydreams?note=${id}`);
    const after = await row(id);
    expect(after).toMatchObject({ status: 'actioned', feedback: 'useful' });
    expect(after.proposed_actions[0].done).toMatchObject({ calendar: 'Home', uid: 'uid-123', undoneAt: null });

    const again = await doIt(id, NOW);
    expect(again).toMatchObject({ ok: true, already: true });
    expect(mock.tool.mock.calls.filter(([n]) => n === 'apple_calendar_create')).toHaveLength(1);
  });

  it('uses a plan the note already carries, without asking a model', async () => {
    await setSetting(ACT_CALENDAR_KEY, 'Home');
    const id = await note([storeAction(PLAN, null)]);
    expect(await doIt(id, NOW)).toMatchObject({ ok: true, status: 'done' });
    expect(mock.draft).not.toHaveBeenCalled();
  });

  it('refuses a draft that moves the date, and writes nothing', async () => {
    await setSetting(ACT_CALENDAR_KEY, 'Home');
    mock.draft.mockResolvedValue({ ...PLAN, date: '2026-10-12' });
    const id = await note();
    expect(await doIt(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('will not guess') });
    expect(mock.tool.mock.calls.some(([n]) => n === 'apple_calendar_create')).toBe(false);
    expect((await row(id)).feedback).toBeNull();
  });

  it('undo finds the entry by its UID, deletes it, and a re-raised note keeps the record', async () => {
    await setSetting(ACT_CALENDAR_KEY, 'Home');
    const id = await note();
    await doIt(id, NOW);
    const undone = await undoIt(id, NOW);
    expect(undone).toMatchObject({ ok: true, status: 'undone' });
    const del = mock.tool.mock.calls.find(([n]) => n === 'apple_calendar_delete')!;
    expect(del[1]).toEqual({ calendar: 'Home', eventId: 'https://caldav.example/home/uid-123.ics' });
    expect((await row(id)).proposed_actions[0].done.undoneAt).toBeTruthy();

    // The think loop re-raising the same key must not wipe what was done.
    await db.execute(sql`UPDATE daydream_thoughts SET status='delivered' WHERE id=${id}`);
    await persistCandidates([{ kind: 'think_efficiency', title: 'Bike dispatch is overdue', explanation: 'again', rawScore: 1,
      components: { audited: 1 }, evidence: [], dedupeKey: id, proposedActions: [] }], { runId: 'test', now: NOW });
    expect((await row(id)).proposed_actions[0].done.uid).toBe('uid-123');
  });

  it('a reminder is a scheduled message to him, cancelled by Undo until it fires', async () => {
    mock.draft.mockResolvedValue({ kind: 'reminder', text: 'Chase the bike dispatch', date: '2026-10-10', time: null });
    mock.tool.mockImplementation(async () => ({ success: true, data: {} }));
    const id = await note();
    expect(await doIt(id, NOW)).toMatchObject({ ok: true, status: 'done', label: expect.stringContaining('remind you on Sat 10 Oct, 09:00') });
    const scheduled = mock.tool.mock.calls.find(([n]) => n === 'schedule_tool_call_at')!;
    expect(scheduled[1]).toMatchObject({
      name: reminderName(id), tool_name: 'notify_owner', fire_at_iso: '2026-10-10T08:00:00.000Z',
      args: { category: 'reminder', body: 'Chase the bike dispatch' },
    });
    expect(await undoIt(id, NOW)).toMatchObject({ ok: true, status: 'undone' });
    expect(mock.tool.mock.calls.find(([n]) => n === 'cancel_scheduled_callback')![1]).toEqual({ name: reminderName(id) });

    // Once it has fired there is nothing to take back.
    const later = await note();
    await doIt(later, NOW);
    expect(await undoIt(later, new Date('2026-10-11T09:00:00Z'))).toMatchObject({ ok: false, reason: expect.stringContaining('already reminded you') });
  });

  it('moves his own entry and Undo puts it back; one with other people is refused', async () => {
    const clash = 'The dentist on 14 October clashes with the school run.\n\nNext: Move the dentist to 16 October.';
    mock.draft.mockResolvedValue({ kind: 'calendar_move', event: 'Dentist', from: '2026-10-14', to: '2026-10-16', time: null });
    const entry = { id: 'https://caldav.example/home/dentist.ics', title: 'Dentist', start: '2026-10-14T08:00:00.000Z', end: '2026-10-14T08:45:00.000Z', calendar: 'Home' };
    mock.tool.mockImplementation(async (name: string) =>
      name === 'apple_calendar_list' ? { success: true, data: { events: [entry, { ...entry, id: 'x', title: 'School run' }] } } : { success: true, data: {} });
    const id = await note([], clash);
    expect(await doIt(id, NOW)).toMatchObject({ ok: true, status: 'done', label: 'Moved “Dentist” to Fri 16 Oct' });
    expect(mock.tool.mock.calls.find(([n]) => n === 'apple_calendar_update')![1]).toEqual({
      calendar: 'Home', eventId: entry.id, start: '2026-10-16T08:00:00.000Z', end: '2026-10-16T08:45:00.000Z',
    });
    await undoIt(id, NOW);
    expect(mock.tool.mock.calls.filter(([n]) => n === 'apple_calendar_update')[1][1]).toEqual({
      calendar: 'Home', eventId: entry.id, start: entry.start, end: entry.end,
    });

    mock.tool.mockImplementation(async (name: string) =>
      name === 'apple_calendar_list' ? { success: true, data: { events: [{ ...entry, attendees: [{ address: 'mailto:dr@example.com' }] }] } } : { success: true, data: {} });
    const shared = await note([], clash);
    expect(await doIt(shared, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('other people invited') });
  });

  it('drafts a reply to the sender code found, sends only on the second tap, and a sent one has no undo', async () => {
    await db.execute(sql`INSERT INTO gmail_accounts(email,refresh_token_enc,scopes,principal_id,status)
      VALUES (${MAILBOX},'synthetic','gmail.modify','owner','active')`);
    mock.draft.mockResolvedValue({ kind: 'email_draft', domain: 'bikeshop.co.uk', subject: 'Where is my bike?',
      body: 'Hello, the order from 26 September has not shipped. When will it? Thanks, John' });
    mock.gmail.listMessages.mockResolvedValue(['m-latest']);
    mock.gmail.fetchMessage.mockResolvedValue({ id: 'm-latest', threadId: 't-1',
      headers: { from: 'Bike Shop <orders@bikeshop.co.uk>', subject: 'Your order is confirmed', messageId: '<abc@bikeshop.co.uk>' } });
    mock.gmail.createDraft.mockResolvedValue({ draftId: 'd-1', messageId: 'dm-1', threadId: 't-1' });
    mock.gmail.sendDraft.mockResolvedValue({ messageId: 's-1', threadId: 't-1' });
    const evidence = [{ kind: 'think-card', id: 'mail_facts:[["query","bike"]]@2026-10-02', note: '2026-09-26 from bikeshop.co.uk (order): Your order is confirmed' }];
    const id = await note([], 'The shop has not dispatched the bike.\n\nNext: Email the shop to chase the dispatch.', evidence);

    expect(await doIt(id, NOW)).toMatchObject({ ok: true, status: 'done', label: expect.stringContaining('Drafted a reply to orders@bikeshop.co.uk') });
    expect(mock.gmail.listMessages.mock.calls[0][1]).toBe('from:bikeshop.co.uk newer_than:180d');
    expect(mock.gmail.createDraft.mock.calls[0][1]).toMatchObject({
      to: 'orders@bikeshop.co.uk', subject: 'Re: Your order is confirmed', threadId: 't-1', inReplyTo: '<abc@bikeshop.co.uk>',
    });
    expect(mock.gmail.sendDraft).not.toHaveBeenCalled();

    expect(await sendIt(id, NOW)).toMatchObject({ ok: true, status: 'sent', label: 'Sent to orders@bikeshop.co.uk' });
    expect(mock.gmail.sendDraft.mock.calls[0][1]).toBe('d-1');
    expect(await undoIt(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('cannot be taken back') });
  });

  it('a draft to a domain the note never showed is refused before Gmail is touched', async () => {
    mock.draft.mockResolvedValue({ kind: 'email_draft', domain: 'elsewhere.com', subject: 'Hello there', body: 'A message that is long enough to pass.' });
    const id = await note([], 'The shop has not dispatched the bike.\n\nNext: Email the shop to chase the dispatch.');
    expect(await doIt(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('will not write to them') });
    expect(mock.gmail.listMessages).not.toHaveBeenCalled();
  });
});
