import { describe, expect, it, vi } from 'vitest';

// The real tool behind the real execution boundary, with iCloud faked. The
// arguments are exactly what Codex sent on 2026-10-03, when every such call
// failed with "createdAfter is required.".
const runAppleCalendar = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { events: [] } })));
vi.mock('$lib/integrations/apple-caldav', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAppleCalendar,
  resolveOptions_calendar: vi.fn(async () => [{ value: 'https://caldav.example/family/', label: 'Family' }]),
}));
vi.mock('$lib/integrations/credentials', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCredentials: vi.fn(async () => [{ id: 'cred-1', label: 'iCloud' }]),
}));

describe('apple_calendar_list with the empty strings Codex sends', () => {
  it('reads the calendar instead of refusing createdAfter', async () => {
    process.env.JKAI_BUILDER_PROCESS = '1';
    const { executeTool } = await import('$lib/tools/registry');
    const result = await executeTool('apple_calendar_list', {
      query: '', calendar: '', createdAfter: '', credentialId: '', dateRangeEnd: 'tomorrow',
      includeRawIcs: false, listCalendars: false, modifiedAfter: '', dateRangeStart: 'tomorrow',
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(runAppleCalendar).toHaveBeenCalledTimes(1);
  });
});
