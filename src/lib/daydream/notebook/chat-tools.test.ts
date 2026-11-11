import { beforeEach, describe, expect, it, vi } from 'vitest';

// The notebook tools (workflow knit 2026-11-11, slice 3). Search reads the
// store's list; add only ever creates. Fixtures are synthetic.

const h = vi.hoisted(() => ({ saved: [] as Array<Record<string, unknown>> }));
const note = (id: string, title: string, body: string, folder = '', tags: string[] = []) => ({ id, title, body, folder, tags, pinned: false, updatedAt: '2026-01-02T03:04:05Z' });

vi.mock('./store', () => ({
  listNotes: async () => [
    note('n1', 'Synthetic boiler', `${'filler '.repeat(120)}the engineer said the valve is worn${' more'.repeat(100)}`, 'House', ['repairs']),
    note('n2', 'Synthetic recipe', 'flour and water', 'Food', ['cooking']),
    note('n3', '', 'untitled first line\nsecond line', '', []),
  ],
  saveNote: async (input: Record<string, unknown>) => {
    h.saved.push(input);
    return { id: 'new1', title: input.title, folder: input.folder ?? '' };
  },
}));

const TIERS: Record<string, [string, string, string]> = {
  notebook_search: ['read', 'never', 'notes'],
  notebook_add: ['mutate', 'light', 'notes'],
};

const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

function contract(forbidden = true) {
  it('declare their tier, are owner-only, and are off every member and WhatsApp list', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: TIERS[name][0], confirm: TIERS[name][1], lane: 'standard' });
      expect(t.toolset, name).toBe(TIERS[name][2]);
      expect(t.surfaces, name).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      if (forbidden) expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), name).toBe(true);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
      if (TIERS[name][0] !== 'read') {
        expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(t) }), name).toBeTruthy();
      }
    }
  });
}

const { noteSnippet, NOTE_BODY_MAX, NOTE_SNIPPET } = await import('./chat-tools');

describe('notebook chat tools', () => {
  beforeEach(() => {
    h.saved = [];
  });
  contract();

  it('notebook_search needs every word, filters by folder and tag, and returns a snippet around the match', async () => {
    const r = await run('notebook_search', { q: 'boiler valve' });
    const d = r.data as { matched: number; notes: Array<{ id: string; snippet: string; folder: string }> };
    expect(d.matched).toBe(1);
    expect(d.notes[0]).toMatchObject({ id: 'n1', folder: 'House', tags: ['repairs'] });
    expect(d.notes[0].snippet.length).toBeLessThanOrEqual(NOTE_SNIPPET + 2);
    expect(((await run('notebook_search', { q: 'boiler flour' })).data as { matched: number }).matched).toBe(0);
    expect(((await run('notebook_search', { folder: 'food' })).data as { notes: Array<{ id: string }> }).notes.map((n) => n.id)).toEqual(['n2']);
    expect(((await run('notebook_search', { tag: 'REPAIRS' })).data as { notes: Array<{ id: string }> }).notes.map((n) => n.id)).toEqual(['n1']);
    const all = (await run('notebook_search', { limit: 2 })).data as { matched: number; notes: unknown[] };
    expect(all.matched).toBe(3);
    expect(all.notes).toHaveLength(2);
    expect(((await run('notebook_search', { q: 'untitled' })).data as { notes: Array<{ title: string }> }).notes[0].title).toBe('untitled first line');
  });

  it('noteSnippet centres on the match and marks what it cut', () => {
    const body = `${'a'.repeat(1000)}needle${'b'.repeat(1000)}`;
    const s = noteSnippet(body, 'needle', 100);
    expect(s).toContain('needle');
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true);
    expect(noteSnippet('short', 'x')).toBe('short');
  });

  it('notebook_add creates as the owner, and refuses an empty or oversized body', async () => {
    expect((await run('notebook_add', { title: 'T' })).error).toMatch(/body/);
    expect((await run('notebook_add', { body: 'x'.repeat(NOTE_BODY_MAX + 1) })).error).toMatch(/at most/);
    expect(h.saved).toEqual([]);
    const r = await run('notebook_add', { title: ' Synthetic ', body: ' note text ', folder: 'House', tags: ['a', 7, 'b'] });
    expect(r.data).toMatchObject({ id: 'new1', title: 'Synthetic', folder: 'House', url: '/jkai/notes' });
    expect(h.saved).toEqual([{ title: 'Synthetic', body: 'note text', folder: 'House', tags: ['a', 'b'], principalId: 'owner' }]);
    expect(h.saved[0]).not.toHaveProperty('id');
  });
});
