import { beforeEach, describe, expect, it, vi } from 'vitest';

// The slice-4 private reads: daydream_inbox, daydream_note_get, briefing_get
// and today_overview. Each is read-only, owner-only (refused for a member
// principal even if a list one day carried it), stays off the member and
// WhatsApp lanes, and has a description with no time-varying text — tool
// definitions sit in the cached prompt prefix. Fixtures are synthetic.

const h = vi.hoisted(() => ({ todaySections: [] as string[] }));

vi.mock('$lib/daydream/summary.server', () => ({
  loadDaydreamSummary: async (opts: { q?: string | null }) => ({
    counts: { waitingOnYou: 1, unrated: 9, inMotion: 0 },
    waiting: [{ id: 'n1', title: 'Synthetic [note]', reason: 'report_back', reasonLabel: 'A report came back', href: '/jkai/daydreams?note=n1' }],
    matched: opts.q ? [{ id: 'n2', title: 'Boiler pressure', href: '/jkai/daydreams?note=n2' }] : [],
  }),
}));
vi.mock('$lib/daydream/think/notes.server', () => ({
  loadFeedNote: async (id: string) =>
    id === 'n1'
      ? {
          id: 'n1', title: 'Synthetic note', url: '/jkai/daydreams?note=n1', createdAt: '2026-10-28T06:00:00.000Z',
          channelLabel: 'Health', outcomeLabel: 'A connection', summary: 'Sleep fell after late meals.', next: 'Eat earlier.',
          read: 'Your diary', sources: [{ label: 'Your diary', detail: 'last 7 days' }], stage: 'decide', bucket: 'decide',
          verdict: null, ownerNote: null, review: null, commission: { id: 'c1', state: 'awaiting_approval' }, stale: null, replaces: [],
        }
      : null,
}));
vi.mock('$lib/briefing/dashboard.server', () => ({
  listBriefingDays: async () => [{ id: '2026-10-28', title: '', startedAt: '', status: 'complete' }],
  loadBriefingDay: async (id: string) =>
    id === '2026-10-28'
      ? { id, title: 'Briefing — Wed 28 Oct', markdown: 'Good morning.', startedAt: '2026-10-28T06:00:00Z', detail: { headline: 'Synthetic', dateLabel: 'Wed 28 Oct', factors: [], connections: [], gaps: [] } }
      : null,
}));
vi.mock('$lib/today/today.server', () => ({
  loadToday: async (opts: { sections: string[] }) => {
    h.todaySections = opts.sections;
    return { generatedAt: 'x', needsYou: null };
  },
}));

const { tools } = await import('../registry-internal');
await import('./daydream');
await import('./briefing');
const { MEMBER_CHAT_TOOLS, MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = ['daydream_inbox', 'daydream_note_get', 'briefing_get', 'today_overview'];
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) =>
  tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

describe('slice 4 private reads', () => {
  beforeEach(() => {
    h.todaySections = [];
  });

  it('are registered read-only in their own toolsets, off every member and WhatsApp list', () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(t, name).toBeTruthy();
      expect(t.destructive).toBeFalsy();
      expect(t.surfaces).toEqual(['chat', 'app']);
      expect((MEMBER_CHAT_TOOLS as readonly string[]).includes(name)).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name)).toBe(false);
      expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset)).toBe(true);
    }
    expect(tool('daydream_inbox').toolset).toBe('daydream');
    expect(tool('today_overview').toolset).toBe('briefing');
  });

  it('carry no time-varying text in their descriptions', () => {
    for (const name of NAMES) {
      const t = tool(name);
      const text = JSON.stringify([t.description, t.parameters]);
      expect(text, name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b|\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/);
    }
  });

  it('refuse a member principal in the handler', async () => {
    for (const name of NAMES) {
      const r = await run(name, { id: 'n1' }, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error).toMatch(/owner/);
    }
  });

  it('daydream_inbox labels notes derived and cites them by link', async () => {
    const r = await run('daydream_inbox', { query: 'boiler' });
    const d = r.data as { label: string; waiting: Array<{ citation: string }>; matched: Array<{ citation: string }> };
    expect(r.success).toBe(true);
    expect(d.label).toMatch(/derived/);
    expect(d.waiting[0].citation).toBe('[Synthetic note](/jkai/daydreams?note=n1)');
    expect(d.matched[0].citation).toBe('[Boiler pressure](/jkai/daydreams?note=n2)');
  });

  it('daydream_note_get returns the note with its double-check link, or a plain miss', async () => {
    const r = await run('daydream_note_get', { id: 'n1' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ stage: 'Your call', waitingOnJohn: true, doubleCheck: { url: '/jkai/daydreams?commission=c1' } });
    expect((await run('daydream_note_get', { id: 'nope' })).success).toBe(false);
  });

  it('briefing_get answers the newest day and refuses a malformed one', async () => {
    const r = await run('briefing_get');
    expect(r.data).toMatchObject({ day: '2026-10-28', url: '/jkai/daydreams/briefing/2026-10-28', markdown: 'Good morning.' });
    expect((await run('briefing_get', { day: 'yesterday' })).error).toMatch(/YYYY-MM-DD/);
    expect((await run('briefing_get', { day: '2026-10-01' })).success).toBe(false);
  });

  it('today_overview reads the shared loader without news', async () => {
    const r = await run('today_overview');
    expect(r.success).toBe(true);
    expect(h.todaySections).toContain('needsYou');
    expect(h.todaySections).not.toContain('news');
  });
});
