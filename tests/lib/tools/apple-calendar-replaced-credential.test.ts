import { describe, expect, it, vi } from 'vitest';

// 2026-10-31: John replaced a revoked iCloud credential with a new connection
// and deleted the old one. Every read then failed with "This Apple Calendar
// credential exposes no calendars" — the new credential listed seven — because
// Codex sends `calendar: []` and an empty list selected nothing.
const runAppleCalendar = vi.hoisted(() => vi.fn(async () => ({ output: { events: [] }, rowCount: 0 })));
const resolveOptions_calendar = vi.hoisted(() => vi.fn(async (_id: string) => [
  { value: 'https://caldav.example/family/', label: 'Family Calendar' },
  { value: 'https://caldav.example/work/', label: 'Personal Calendar' },
]));
vi.mock('$lib/integrations/apple-caldav', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAppleCalendar,
  resolveOptions_calendar,
}));
vi.mock('$lib/integrations/credentials', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCredentials: vi.fn(async () => [{ id: 'cred-new', label: 'apple-calendar' }]),
}));

describe('resolveCalendarSelection', () => {
  it('reads every calendar for an empty list', async () => {
    const { resolveCalendarSelection } = await import('$lib/tools/tools/apple-calendar');
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    expect(resolveCalendarSelection(options, [])).toEqual(options);
    expect(resolveCalendarSelection(options, [''])).toEqual(options);
  });
});

describe('resolveAppleCredential after a replacement', () => {
  it('follows the only credential when the named one was deleted', async () => {
    const { resolveAppleCredential } = await import('$lib/tools/tools/apple-calendar');
    expect(await resolveAppleCredential('cred-deleted')).toEqual({ credentialId: 'cred-new' });
  });

  it('keeps a named credential that still exists', async () => {
    const { resolveAppleCredential } = await import('$lib/tools/tools/apple-calendar');
    expect(await resolveAppleCredential('cred-new')).toEqual({ credentialId: 'cred-new' });
  });
});

describe('apple_calendar_list with the arguments Codex sent on 2026-10-31', () => {
  it('reads both calendars', async () => {
    process.env.JKAI_BUILDER_PROCESS = '1';
    const { executeTool } = await import('$lib/tools/registry');
    const result = await executeTool('apple_calendar_list', {
      query: '', calendar: [], createdAfter: '', credentialId: '', dateRangeEnd: 'tomorrow',
      includeRawIcs: false, listCalendars: false, modifiedAfter: '', dateRangeStart: 'today',
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runAppleCalendar).toHaveBeenCalledTimes(2);
  });
});
