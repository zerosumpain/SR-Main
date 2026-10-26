import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture, CaptureAction } from '$lib/db/schema';

// The dispatch from an approved follow-up to the tool it runs, with the tool
// registry, the outbox and the row writer stubbed. Every fixture is synthetic.

const h = vi.hoisted(() => ({
  executeTool: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ success: true, data: {} as Record<string, unknown> })),
  enqueueIntelJob: vi.fn(async () => 77),
  updateAction: vi.fn(async (id: string, set: Record<string, unknown>) => ({ id, ...set })),
  actCalendar: vi.fn(async () => 'Home' as string | null),
}));

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/tools/registry', () => ({ executeTool: h.executeTool }));
vi.mock('$lib/intel-client/outbox', () => ({ enqueueIntelJob: h.enqueueIntelJob }));
vi.mock('$lib/daydream/act/act.server', () => ({ actCalendar: h.actCalendar }));
vi.mock('./store.server', () => ({
  updateAction: h.updateAction,
  rememberRefId: (c: string, a: string) => `${c}/remember/${a}`,
}));

const { executeCaptureAction, runApprovedAction, draftFor } = await import('./actions.server');

const NOW = new Date('2026-10-26T12:00:00Z');
const CAP = { id: 'cap_1', spaceId: 'owner' } as Capture;

function action(kind: string, params: Record<string, unknown> = {}, extra: Partial<CaptureAction> = {}): CaptureAction {
  return {
    id: 'cact_1',
    captureId: 'cap_1',
    spaceId: 'owner',
    kind,
    title: 'Do the thing',
    detail: null,
    who: null,
    dueAt: null,
    params,
    state: 'approved',
    refKind: null,
    refId: null,
    error: null,
    createdAt: NOW,
    decidedAt: NOW,
    ...extra,
  };
}

beforeEach(() => {
  h.executeTool.mockClear();
  h.enqueueIntelJob.mockClear();
  h.updateAction.mockClear();
  h.actCalendar.mockClear();
  h.executeTool.mockImplementation(async () => ({ success: true, data: {} }));
});

describe('executeCaptureAction', () => {
  it('research → research_start, recording the session', async () => {
    h.executeTool.mockResolvedValueOnce({ success: true, data: { id: 'rs_9' } });
    const out = await executeCaptureAction(action('research', { question: 'Heat pump grants in 2026' }), CAP, NOW);
    expect(h.executeTool).toHaveBeenCalledWith('research_start', expect.objectContaining({ topic: 'Heat pump grants in 2026', depth: 'brief' }));
    expect(out).toEqual({ state: 'done', refKind: 'research', refId: 'rs_9' });
  });

  it('calendar → apple_calendar_create on the chosen calendar, an hour by default', async () => {
    h.executeTool.mockResolvedValueOnce({ success: true, data: { url: '/cal/ev1.ics' } });
    const out = await executeCaptureAction(
      action('calendar', { title: 'Dentist', start: '2026-11-02T09:00:00.000Z', attendees: ['Sarah'] }),
      CAP,
      NOW,
    );
    const [name, args] = h.executeTool.mock.calls[0];
    expect(name).toBe('apple_calendar_create');
    expect(args).toMatchObject({ calendar: 'Home', title: 'Dentist', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' });
    expect(String(args.notes)).toContain('With: Sarah');
    expect(out).toEqual({ state: 'done', refKind: 'calendar', refId: '/cal/ev1.ics' });
  });

  it('calendar fails, writing nothing, when no calendar has been chosen', async () => {
    h.actCalendar.mockResolvedValueOnce(null);
    const out = await executeCaptureAction(action('calendar', { title: 'Dentist', start: '2026-11-02T09:00:00.000Z' }), CAP, NOW);
    expect(out.state).toBe('failed');
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('followup → a scheduled notify_owner at `when`', async () => {
    const out = await executeCaptureAction(action('followup', { when: '2026-10-28T09:00:00.000Z', message: 'Chase Bob' }), CAP, NOW);
    const [name, args] = h.executeTool.mock.calls[0];
    expect(name).toBe('schedule_tool_call_at');
    expect(args).toMatchObject({ tool_name: 'notify_owner', fire_at_iso: '2026-10-28T09:00:00.000Z', name: 'capture-remind-cact_1' });
    expect((args.args as Record<string, unknown>).body).toBe('Chase Bob');
    expect(out).toEqual({ state: 'done', refKind: 'callback', refId: 'capture-remind-cact_1' });
  });

  it('refuses a reminder in the past without scheduling it', async () => {
    const out = await executeCaptureAction(action('followup', { when: '2026-10-01T09:00:00.000Z', message: 'Too late' }), CAP, NOW);
    expect(out.state).toBe('failed');
    expect(h.executeTool).not.toHaveBeenCalled();
  });

  it('todo_me with no due date → tomorrow at nine, London', async () => {
    await executeCaptureAction(action('todo_me'), CAP, NOW);
    expect(h.executeTool.mock.calls[0][1]).toMatchObject({ fire_at_iso: '2026-10-27T09:00:00.000Z' });
  });

  it('todo_other only drafts: no tool runs and nothing is sent', async () => {
    const out = await executeCaptureAction(action('todo_other', {}, { who: 'Sarah Jones', title: 'Send the slides' }), CAP, NOW);
    expect(h.executeTool).not.toHaveBeenCalled();
    expect(out.state).toBe('done');
    expect(out.refKind).toBe('draft');
    expect(out.params?.draft).toContain('Hi Sarah');
  });

  it('remember → a note job filed under the capture, in its space', async () => {
    const out = await executeCaptureAction(action('remember', { fact: 'Sarah moved to Leeds', entity: 'Sarah' }), CAP, NOW);
    expect(h.enqueueIntelJob).toHaveBeenCalledWith(
      'note',
      'capture:cap_1',
      expect.objectContaining({
        content: 'Sarah moved to Leeds',
        spaceId: 'owner',
        metadata: expect.objectContaining({ autoKind: 'capture', refId: 'cap_1/remember/cact_1' }),
      }),
    );
    expect(out).toEqual({ state: 'done', refKind: 'intel-job', refId: '77' });
  });

  it('turns a tool failure, or a throw, into `failed` with the reason', async () => {
    h.executeTool.mockResolvedValueOnce({ success: false, error: 'calendar offline' } as never);
    expect(await executeCaptureAction(action('research', { question: 'Anything at all' }), CAP, NOW)).toMatchObject({ state: 'failed' });
    h.executeTool.mockRejectedValueOnce(new Error('boom'));
    expect(await executeCaptureAction(action('research', { question: 'Anything at all' }), CAP, NOW)).toEqual({ state: 'failed', error: 'boom' });
  });

  it('refuses a kind outside the closed list', async () => {
    expect(await executeCaptureAction(action('send_email'), CAP, NOW)).toMatchObject({ state: 'failed' });
    expect(h.executeTool).not.toHaveBeenCalled();
  });
});

describe('runApprovedAction', () => {
  it('records a quick kind straight away', async () => {
    const row = await runApprovedAction(action('todo_other', {}, { who: 'Ann' }), CAP);
    expect(h.updateAction).toHaveBeenCalledWith('cact_1', expect.objectContaining({ state: 'done', refKind: 'draft' }));
    expect(row.state).toBe('done');
  });

  it('answers `approved` for research and finishes it in the background', async () => {
    let release!: () => void;
    h.executeTool.mockImplementationOnce(() => new Promise((r) => (release = () => r({ success: true, data: { id: 'rs_1' } }))));
    const row = await runApprovedAction(action('research', { question: 'Something long' }), CAP);
    expect(row.state).toBe('approved');
    expect(h.updateAction).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.executeTool).toHaveBeenCalled());
    release();
    await vi.waitFor(() => expect(h.updateAction).toHaveBeenCalledWith('cact_1', expect.objectContaining({ state: 'done', refId: 'rs_1' })));
  });
});

describe('draftFor', () => {
  it('writes words, not a send', () => {
    expect(draftFor({ who: null, title: 'Book the hall', detail: 'For Saturday' })).toBe('Hi,\n\nBook the hall\nFor Saturday\n\nThanks');
  });
});
