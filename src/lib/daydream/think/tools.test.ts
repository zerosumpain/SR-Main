import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('$lib/workflows/site-tools/executor', () => ({ executeSiteTool: vi.fn() }));
vi.mock('$lib/workflows/site-tools/llm-tools', () => ({ getToolDefinitionsByName: vi.fn(async () => []) }));
vi.mock('./health', () => ({
  HUB_SECTIONS: ['read'],
  healthHubTool: vi.fn(async () => 'hub text'),
  healthSeriesTool: vi.fn(async () => 'series text'),
  healthSeriesDescription: () => 'series',
}));
vi.mock('./reads', () => ({
  mailFactsTool: vi.fn(async () => 'mail'),
  diaryTool: vi.fn(async () => 'diary'),
  spendTool: vi.fn(async () => 'spend'),
  chatThreadsTool: vi.fn(async () => 'chat'),
}));

import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { healthHubTool } from './health';
import {
  CARD_CHARS,
  LOCAL_TOOLS,
  MAX_TOOL_CALLS,
  PRIVATE_SITE_TOOLS,
  PRIVATE_TOOLS,
  RESEARCH_TOOLS,
  createToolbox,
  makeCard,
  renderCard,
  stableArgs,
  toolSetFor,
} from './tools';

const TOOLS_DIR = join(process.cwd(), 'src/lib/workflows/site-tools/tools');
const THINK_DIR = join(process.cwd(), 'src/lib/daydream/think');

/** Every `name: '…'` registered in a tool module, and whether its block says destructive. */
function registeredTools(): Map<string, { file: string; destructive: boolean }> {
  const out = new Map<string, { file: string; destructive: boolean }>();
  for (const f of readdirSync(TOOLS_DIR).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const src = readFileSync(join(TOOLS_DIR, f), 'utf8');
    for (const m of src.matchAll(/name:\s*'([a-z_]+)'(,\s*destructive:\s*true)?/g)) {
      out.set(m[1], { file: f, destructive: Boolean(m[2]) });
    }
  }
  return out;
}

const BOX = { now: new Date('2026-09-25T18:00:00Z'), day: '2026-09-25', subject: 'john' };

beforeEach(() => vi.clearAllMocks());

describe('the two allow-lists', () => {
  it('are exactly these, and a change here is a security decision', () => {
    // Pinned in full. Adding a row means reading the tool's implementation and
    // deciding it is read-only AND not somebody else's prose — see tools.ts.
    expect([...PRIVATE_TOOLS]).toEqual([
      'ha_find',
      'ha_query_state',
      'ha_get_history',
      'memory_search',
      'health_timeline',
      'health_hub',
      'health_series',
      'correlate',
      'mail_facts',
      'diary',
      'spend',
      'chat_threads',
    ]);
    expect([...RESEARCH_TOOLS]).toEqual(['research_web_search', 'fetch_url']);
  });

  it('never share a tool', () => {
    const research = new Set(RESEARCH_TOOLS);
    for (const t of PRIVATE_TOOLS) expect(research.has(t), t).toBe(false);
  });

  it('keep every web tool out of the private set', () => {
    // A private cycle that can reach outwards is the injection path the
    // two-set split exists to close.
    for (const t of PRIVATE_TOOLS) {
      expect(t).not.toMatch(/^(fetch_|research_|browser_|web_|scrape|http)/);
    }
  });

  it('keep every private tool out of the research set', () => {
    for (const t of LOCAL_TOOLS) expect(RESEARCH_TOOLS).not.toContain(t);
    for (const t of PRIVATE_SITE_TOOLS) expect(RESEARCH_TOOLS).not.toContain(t);
  });

  it('contain nothing that returns a stranger’s prose at length to a private cycle', () => {
    const banned = ['mail_read', 'mail_search', 'session_search', 'gmail_get_message', 'gmail_get_thread', 'gmail_search', 'fetch_url'];
    for (const t of PRIVATE_TOOLS) expect(banned).not.toContain(t);
  });

  it('contain no tool that writes', () => {
    // The `destructive` flag is not a read-only list: every one of these writes
    // and several are unflagged.
    const writes = [
      'ha_call_service', 'ha_fire_event', 'ha_render_template', 'workflow_run', 'build_create', 'blog_create',
      'datastore_save', 'save_memory', 'memory_remember', 'forget_memory', 'gmail_send', 'gmail_reply',
      'gmail_modify_labels', 'whatsapp_send', 'publish_page', 'apple_calendar_create', 'apple_calendar_update',
      'apple_calendar_delete', 'research_start',
    ];
    for (const t of [...PRIVATE_TOOLS, ...RESEARCH_TOOLS]) expect(writes, t).not.toContain(t);
  });

  it('name site tools that really are registered, and none flagged destructive', () => {
    // A renamed tool would otherwise drop silently out of the allow-list.
    const registered = registeredTools();
    for (const t of [...PRIVATE_SITE_TOOLS, ...RESEARCH_TOOLS]) {
      expect(registered.has(t), `${t} is registered`).toBe(true);
      expect(registered.get(t)?.destructive, `${t} is not destructive`).toBe(false);
    }
  });

  it('never collide a local tool with a registered name', () => {
    const registered = registeredTools();
    for (const t of LOCAL_TOOLS) expect(registered.has(t), t).toBe(false);
  });

  it('give the research channel the research set and every other channel the private one', () => {
    expect(toolSetFor('research')).toBe('research');
    for (const c of ['health', 'home', 'mail', 'chat', 'diary', 'money'] as const) expect(toolSetFor(c)).toBe('private');
  });
});

describe('mail stays the owner’s', () => {
  it('has no gmail tool in either set — nothing here picks a mailbox', () => {
    // An unfiltered "most recently updated account" resolves to a member's
    // mailbox the moment their token refreshes.
    for (const t of [...PRIVATE_TOOLS, ...RESEARCH_TOOLS]) expect(t.startsWith('gmail_')).toBe(false);
  });

  it('never imports the gmail module from the think loop', () => {
    for (const f of readdirSync(THINK_DIR).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const src = readFileSync(join(THINK_DIR, f), 'utf8');
      expect(src, f).not.toMatch(/(from\s+|import\()\s*'\$lib\/workflows\/gmail/);
    }
  });

  it('scopes every intel read in the mail tool to the owner', () => {
    const src = readFileSync(join(THINK_DIR, 'reads.ts'), 'utf8');
    const reads = src.match(/\.from\((intelNotes|intelTimelineEvents)\)/g) ?? [];
    const scoped = src.match(/spaceIn\((intelNotes|intelTimelineEvents)\.spaceId, OWNER_INTEL_SCOPE\)/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect(scoped.length).toBe(reads.length);
    // And never the body.
    expect(src).not.toMatch(/rawContent|processedContent/);
  });
});

describe('cards', () => {
  it('truncates long results and numbers them', () => {
    const card = makeCard(3, 'health_hub', {}, 'x'.repeat(CARD_CHARS + 50), '2026-09-25');
    expect(card.id).toBe('C3');
    expect(card.text.length).toBeLessThan(CARD_CHARS + 60);
    expect(card.text).toMatch(/truncated, 50 more chars/);
  });

  it('gives the same read the same ref whatever the argument order', () => {
    expect(stableArgs({ a: 1, b: 2 })).toBe(stableArgs({ b: 2, a: 1 }));
    const x = makeCard(1, 'correlate', { a: 'steps', b: 'sleepMinutes' }, 't', '2026-09-25');
    const y = makeCard(9, 'correlate', { b: 'sleepMinutes', a: 'steps' }, 'u', '2026-09-25');
    expect(x.ref).toBe(y.ref);
  });

  it('shows the model the id first', () => {
    expect(renderCard(makeCard(2, 'spend', { days: 30 }, 'rows', '2026-09-25'))).toMatch(/^\[C2\] spend\(/);
  });
});

describe('the toolbox', () => {
  it('refuses a tool outside its set without running anything', async () => {
    const box = createToolbox({ ...BOX, set: 'research' });
    const out = await box.call('health_hub', {});
    expect(out.failed).toBe(true);
    expect(out.card).toBeNull();
    expect(healthHubTool).not.toHaveBeenCalled();
    expect(executeSiteTool).not.toHaveBeenCalled();
  });

  it('refuses a web tool in a private cycle', async () => {
    const box = createToolbox({ ...BOX, set: 'private' });
    const out = await box.call('fetch_url', { url: 'https://example.com' });
    expect(out.failed).toBe(true);
    expect(executeSiteTool).not.toHaveBeenCalled();
  });

  it('passes its allow-list to the executor as the capability scope', async () => {
    vi.mocked(executeSiteTool).mockResolvedValue({ success: true, data: { ok: 1 } });
    const box = createToolbox({ ...BOX, set: 'private' });
    await box.call('ha_find', { query: 'heating' });
    const ctx = vi.mocked(executeSiteTool).mock.calls[0][2];
    expect(ctx?.allowedTools).toEqual([...PRIVATE_TOOLS]);
  });

  it('cards a success and issues ids in order', async () => {
    vi.mocked(executeSiteTool).mockResolvedValue({ success: true, data: { results: [] } });
    const box = createToolbox({ ...BOX, set: 'research' });
    const a = await box.call('research_web_search', { query: 'x' });
    const b = await box.call('fetch_url', { url: 'https://example.com' });
    expect(a.card?.id).toBe('C1');
    expect(b.card?.id).toBe('C2');
    expect([...box.cards.keys()]).toEqual(['C1', 'C2']);
  });

  it('issues no card for a failed tool, so nothing can cite it', async () => {
    vi.mocked(executeSiteTool).mockResolvedValue({ success: false, error: 'HA down' });
    const box = createToolbox({ ...BOX, set: 'private' });
    const out = await box.call('ha_find', {});
    expect(out.card).toBeNull();
    expect(box.cards.size).toBe(0);
    expect(out.content).toMatch(/No card/);
  });

  it('stops at the call budget', async () => {
    const box = createToolbox({ ...BOX, set: 'private' });
    for (let i = 0; i < MAX_TOOL_CALLS; i++) await box.call('health_hub', {});
    const over = await box.call('health_hub', {});
    expect(over.failed).toBe(true);
    expect(healthHubTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
  });

  it('offers a schema with at least one property for every local tool', async () => {
    // `{type:'object', properties:{}}` arrives on Codex as `{}`.
    const box = createToolbox({ ...BOX, set: 'private' });
    const defs = await box.definitions();
    const local = defs.filter((d) => (LOCAL_TOOLS as readonly string[]).includes(d.function.name));
    expect(local).toHaveLength(LOCAL_TOOLS.length);
    for (const d of local) {
      const props = (d.function.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props).length, d.function.name).toBeGreaterThan(0);
    }
  });
});
