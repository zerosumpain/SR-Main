import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeInvokePrincipal } from './principal';

const h = vi.hoisted(() => ({
  queries: [] as string[],
  params: [] as unknown[][],
  traceRows: 1,
  sources: [] as Array<{ id: string; source: string }>,
}));

vi.mock('$lib/db', () => ({
  db: {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q);
      h.queries.push(text);
      if (text.includes('jkai_conversations')) return { rows: h.sources };
      return { rowCount: h.traceRows, rows: [] };
    },
  },
}));

const { recordInvocationPrincipal, flushPrincipals, stampFor, _resetPrincipalLog } = await import('./record.server');

beforeEach(() => {
  _resetPrincipalLog();
  h.queries = [];
  h.traceRows = 1;
  h.sources = [];
});

describe('computeInvokePrincipal', () => {
  it('reads a jobbed web turn as an attended session, and says the device is unknown', () => {
    expect(computeInvokePrincipal({ lane: 'destructive', principalId: 'owner', jobId: 'j', conversationSource: 'web' })).toEqual({
      kind: 'owner', id: 'owner', via: 'session', attended: true, lane: 'destructive',
      toolScope: 'unrestricted', allowedToolCount: null,
      basis: ['lane:destructive', 'principalId', 'source:web', 'jobId', 'device-unknown'],
    });
  });

  it('reads a WhatsApp thread as whatsapp and unattended, whatever else it carries', () => {
    const p = computeInvokePrincipal({ lane: 'standard', conversationSource: 'whatsapp', allowedTools: ['a', 'b'] });
    expect(p).toMatchObject({ via: 'whatsapp', attended: false, toolScope: 'listed', allowedToolCount: 2, id: 'owner' });
  });

  it('reads a call with no job as an unattended service call', () => {
    expect(computeInvokePrincipal({ lane: 'standard' })).toMatchObject({ via: 'service', attended: false, kind: 'owner' });
  });

  it('keeps a member a member, and an app thread a device', () => {
    expect(computeInvokePrincipal({ lane: 'standard', principalId: 'u_abc', jobId: 'j', conversationSource: 'app', allowedTools: [] }))
      .toMatchObject({ kind: 'member', id: 'u_abc', via: 'device', attended: true, toolScope: 'listed', allowedToolCount: 0 });
  });
});

describe('computeInvokePrincipal with the turn envelope', () => {
  it('reads a jobbed turn from a verified phone as a device, and says so in the basis', () => {
    const p = computeInvokePrincipal({ lane: 'standard', principalId: 'owner', jobId: 'j', conversationSource: 'web', surface: 'ios', deviceId: 'dev_1' });
    expect(p).toMatchObject({ via: 'device', attended: true, surface: 'ios', deviceId: 'dev_1' });
    expect(p.basis).toEqual(expect.arrayContaining(['surface:ios', 'deviceId', 'jobId']));
    expect(p.basis).not.toContain('device-unknown');
  });

  it('reads a web turn as a session without guessing at a device', () => {
    const p = computeInvokePrincipal({ lane: 'standard', jobId: 'j', conversationSource: 'whatsapp-continuation', surface: 'web' });
    // The thread is WhatsApp's, and that still wins: the label is not a grant.
    expect(p.via).toBe('whatsapp');
    expect(computeInvokePrincipal({ lane: 'standard', jobId: 'j', surface: 'web' })).toMatchObject({ via: 'session', attended: true });
    expect(computeInvokePrincipal({ lane: 'standard', jobId: 'j', surface: 'web' }).basis).not.toContain('device-unknown');
  });

  it('never reads a Siri or Watch turn as attended', () => {
    expect(computeInvokePrincipal({ lane: 'standard', jobId: 'j', surface: 'siri', deviceId: 'dev_1' })).toMatchObject({ via: 'device', attended: false });
  });

  it('reads a WhatsApp or heartbeat surface as that lane, whatever the thread says', () => {
    expect(computeInvokePrincipal({ lane: 'standard', surface: 'whatsapp', conversationSource: 'web' }).via).toBe('whatsapp');
    expect(computeInvokePrincipal({ lane: 'standard', surface: 'heartbeat' })).toMatchObject({ via: 'heartbeat', attended: false });
  });
});

describe('stampFor', () => {
  it('groups a turn\'s calls by principal and counts them per tool', () => {
    const calls = [
      { tool: 'gmail_search', lane: 'standard' as const, jobId: 'j' },
      { tool: 'gmail_search', lane: 'standard' as const, jobId: 'j' },
      { tool: 'gmail_send', lane: 'destructive' as const, jobId: 'j' },
    ];
    const s = stampFor({ firstAt: 0, lastAt: 1000, calls }, 'web');
    expect(s.version).toBe(1);
    expect(s.principals.map((p) => [p.lane, p.calls])).toEqual([
      ['standard', { gmail_search: 2 }],
      ['destructive', { gmail_send: 1 }],
    ]);
  });
});

describe('flushPrincipals', () => {
  it("stamps the trace row once Core has written it, via jsonb_set on steps", async () => {
    h.sources = [{ id: 'conv-1', source: 'web' }];
    recordInvocationPrincipal({ tool: 'gmail_search', lane: 'standard', jobId: 'job-1', conversationId: 'conv-1' });
    expect(await flushPrincipals()).toEqual({ stamped: 1, logged: 0, waiting: 0 });
    const update = h.queries.find((q) => q.includes('UPDATE jkai_tool_traces'));
    expect(update).toContain('jsonb_set(steps');
    expect(update).toContain('job-1');
    expect(update).toContain('\\"via\\":\\"session\\"');
  });

  it('keeps waiting while the row does not exist yet, then gives up and logs', async () => {
    h.traceRows = 0;
    const t0 = 1_000_000;
    recordInvocationPrincipal({ tool: 'fetch_url', lane: 'standard', jobId: 'job-2' }, t0);
    expect(await flushPrincipals(t0 + 60_000)).toEqual({ stamped: 0, logged: 0, waiting: 1 });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await flushPrincipals(t0 + 21 * 60_000)).toEqual({ stamped: 0, logged: 1, waiting: 0 });
    expect(info.mock.calls[0][0]).toContain('"untraced":true');
    info.mockRestore();
  });

  it('logs a jobless call (the service turn) as a line, since it has no trace row', async () => {
    h.sources = [{ id: 'wa-1', source: 'whatsapp' }];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    recordInvocationPrincipal({ tool: 'gmail_search', lane: 'standard', conversationId: 'wa-1', allowedTools: ['gmail_search'] });
    expect(await flushPrincipals()).toEqual({ stamped: 0, logged: 1, waiting: 0 });
    expect(h.queries.some((q) => q.includes('UPDATE'))).toBe(false);
    expect(info.mock.calls[0][0]).toContain('"via":"whatsapp"');
    info.mockRestore();
  });

  it('never throws on the tool path', () => {
    expect(() => recordInvocationPrincipal(null as never)).not.toThrow();
  });
});
