import { beforeEach, describe, expect, it, vi } from 'vitest';

// The fourth apple_calendar_list failure since 10-03 (2026-10-23): iCloud
// answered 401 to the stored app-specific password. The error text below is
// the one recorded in jkai_tool_traces, with the arguments Codex sent.
const caldav = vi.hoisted(() => ({
  runAppleCalendar: vi.fn(),
  resolveOptions_calendar: vi.fn(),
}));
const credentials = vi.hoisted(() => ({
  listCredentials: vi.fn(async () => [{ id: 'cred-1', label: 'family calendar' }]),
  updateCredential: vi.fn(async () => undefined),
}));
vi.mock('$lib/integrations/apple-caldav', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...caldav,
}));
vi.mock('$lib/integrations/credentials', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...credentials,
}));

const REJECTED = new Error('Invalid credentials: PROPFIND https://caldav.icloud.com returned 401 Unauthorized');
const ARGS = {
  query: 'Vatican', calendar: '', createdAfter: '', credentialId: '', dateRangeEnd: '+10d',
  includeRawIcs: false, listCalendars: false, modifiedAfter: '', dateRangeStart: 'today',
};

async function list() {
  process.env.JKAI_BUILDER_PROCESS = '1';
  const { executeTool } = await import('$lib/tools/registry');
  return executeTool('apple_calendar_list', ARGS);
}

describe('apple_calendar_list when iCloud rejects the credential', () => {
  beforeEach(() => {
    caldav.runAppleCalendar.mockReset();
    caldav.resolveOptions_calendar.mockReset();
    credentials.updateCredential.mockClear();
  });

  it('says the credential needs replacing and not to retry', async () => {
    caldav.resolveOptions_calendar.mockRejectedValue(REJECTED);
    const result = await list();
    expect(result.success).toBe(false);
    expect(result.error).toContain('do not retry');
    expect(result.error).toContain('app-specific password');
    expect(result.error).toContain('/admin/connections/credentials?replace=cred-1');
    expect(caldav.runAppleCalendar).not.toHaveBeenCalled();
  });

  it('marks the credential failed so the connections page shows it', async () => {
    caldav.resolveOptions_calendar.mockRejectedValue(REJECTED);
    await list();
    expect(credentials.updateCredential).toHaveBeenCalledWith(
      'cred-1',
      expect.objectContaining({ lastTestStatus: 'failed', lastTestError: REJECTED.message }),
    );
  });

  it('keeps the plain error, and the credential untouched, for any other fault', async () => {
    caldav.resolveOptions_calendar.mockRejectedValue(new Error('getaddrinfo EAI_AGAIN caldav.icloud.com'));
    const result = await list();
    expect(result.error).toBe('Unable to access Apple Calendar: getaddrinfo EAI_AGAIN caldav.icloud.com');
    expect(credentials.updateCredential).not.toHaveBeenCalled();
  });

  it('still reads "+10d" and the empty optional strings once the credential works', async () => {
    caldav.resolveOptions_calendar.mockResolvedValue([{ value: 'https://caldav.example/family/', label: 'Family' }]);
    caldav.runAppleCalendar.mockResolvedValue({ success: true, output: { events: [] } });
    const result = await list();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
