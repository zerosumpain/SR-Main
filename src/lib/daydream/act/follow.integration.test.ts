import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

// Faked: the calendar and Home Assistant tools, the research worker, the
// builder sidecar, the subscription meter, the watch generator and the model.
// Every write to the note, the research session and the build row is real,
// against the isolated local database.
const mock = vi.hoisted(() => ({
  tool: vi.fn(),
  startResearch: vi.fn(),
  startBuild: vi.fn(),
  quota: vi.fn(),
  createMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  loop: vi.fn(),
  draft: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
vi.mock('$lib/tools/registry', () => ({ executeTool: mock.tool }));
vi.mock('$lib/deepdive/worker', () => ({ startResearch: mock.startResearch }));
vi.mock('$lib/jkai/orchestrator', () => ({ orchestrator: { startBuild: mock.startBuild } }));
vi.mock('../budget', async (orig) => ({ ...(await orig<typeof import('../budget')>()), readQuotaMark: mock.quota }));
vi.mock('$lib/monitors/monitors.server', () => ({ createMonitor: mock.createMonitor, deleteMonitor: mock.deleteMonitor }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => ({ client: {}, model: 'stub' }) }));
vi.mock('$lib/llm/tool-loop', () => ({ runToolLoop: mock.loop }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveBuilderModel: async () => ({ provider: 'openrouter', modelId: 'stub/builder' }), resolveChatTurnModel: async () => ({ provider: 'openrouter', modelId: 'stub/chat' }) }));
vi.mock('./plan.server', () => ({ draftPlan: mock.draft, KIND_SHAPES: [] }));
import { db } from '$lib/db';
import {
  acceptBuild,
  checkHome,
  digDeeper,
  draftBrief,
  draftMessage,
  gmailDraft,
  promote,
  refreshHome,
  startPrototype,
  startWatch,
  stopWatch,
  type BacklogPorts,
} from './follow.server';
import { doIt, undoIt, ACT_CALENDAR_KEY } from './act.server';
import { readFollow } from './follow';
import { supersedeOnTopic } from '../think/notes.server';
import { setSetting } from '$lib/server/models/settings';

const database = process.env.DATABASE_URL ?? '';
const enabled = /(?:127\.0\.0\.1|localhost):15445\//.test(database)
  || (process.env.GITHUB_ACTIONS === 'true' && process.env.DAYDREAM_COMMISSION_TESTS === '1'
    && /(?:127\.0\.0\.1|localhost):5432\/strange_rambling$/.test(database));

const ids: string[] = [];
const sessions: string[] = [];
const builds: string[] = [];
const NOW = new Date('2026-10-05T18:00:00Z');

async function note(o: { kind?: string; title?: string; narrative?: string; evidence?: unknown[]; feedback?: string | null; actions?: unknown[]; created?: Date; status?: string } = {}) {
  const id = `uiseed-follow-${randomUUID()}`;
  ids.push(id);
  await db.execute(sql`INSERT INTO daydream_thoughts(id,kind,title,explanation,narrative,dedupe_key,status,evidence,proposed_actions,feedback,created_at)
    VALUES (${id},${o.kind ?? 'think_suggest'},${o.title ?? 'Book the Dunbar–Barns Ness geology walk on 16 October'},'Read 1 card.',
      ${o.narrative ?? 'Angus Miller leads the walk on Friday 16 October 2026 at 11:00. Tickets £25.\n\nNext: Read the walk listing and book an adult place.'},
      ${id},${o.status ?? 'suppressed'},${JSON.stringify(o.evidence ?? [])}::jsonb,${JSON.stringify(o.actions ?? [])}::jsonb,${o.feedback ?? null},${(o.created ?? NOW).toISOString()})`);
  return id;
}
const row = async (id: string) =>
  (await db.execute(sql`SELECT status,suppressed_reason,feedback,proposed_actions FROM daydream_thoughts WHERE id=${id}`)).rows[0] as {
    status: string; suppressed_reason: string | null; feedback: string | null; proposed_actions: unknown[];
  };

function ports(): BacklogPorts & { calls: string[] } {
  const calls: string[] = [];
  const item = { slug: 'uiseed-follow-item', title: 'Physics toy', detail: 'd', kind: 'feature', priority: 3, status: 'open' };
  return {
    calls,
    async intake(idea) { calls.push(`intake:${idea.ref}`); return { slug: item.slug }; },
    async item() { return item; },
    async groom() { calls.push('groom'); return { outcome: 'A one-page physics toy', acceptanceCriteria: ['Balls bounce'], effort: 'S', risk: 'low', readiness: { status: 'ready', reason: 'clear' } }; },
    async accept(_i, g) { calls.push(`accept:${String(g.outcome)}`); },
  };
}

describe.skipIf(!enabled)('taking a note further, against isolated local Postgres', () => {
  beforeEach(() => {
    for (const f of Object.values(mock)) f.mockReset();
    mock.quota.mockResolvedValue({ fiveHourPct: 10, weeklyPct: 20 });
    mock.startBuild.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    for (const id of ids) await db.execute(sql`DELETE FROM daydream_thoughts WHERE id=${id}`);
    for (const s of sessions) await db.execute(sql`DELETE FROM research_session WHERE id=${s}`);
    for (const b of builds) await db.execute(sql`DELETE FROM jkai_builds WHERE id=${b}`);
    await db.execute(sql`DELETE FROM app_settings WHERE key=${ACT_CALENDAR_KEY}`);
  });

  it('digs deeper: a real brief research session, started after the commit, once', async () => {
    const id = await note({ evidence: [{ kind: 'think-card', id: 'fetch_url:[["url","https://example.org/walk"]]@2026-10-05', note: '{"url":"https://example.org/walk"}' }] });
    const res = await digDeeper(id, NOW);
    expect(res).toMatchObject({ ok: true, href: expect.stringMatching(/^\/research\//) });
    const sessionId = String(readFollow((await row(id)).proposed_actions).research?.data.sessionId);
    sessions.push(sessionId);
    const s = (await db.execute(sql`SELECT depth, status, scope FROM research_session WHERE id=${sessionId}`)).rows[0] as { depth: string; status: string; scope: { seedUrls?: string[] } };
    expect(s).toMatchObject({ depth: 'brief', status: 'draft' });
    expect(s.scope.seedUrls).toEqual(['https://example.org/walk']);
    expect(mock.startResearch).toHaveBeenCalledWith(sessionId);
    expect(await digDeeper(id, NOW)).toMatchObject({ ok: true, message: expect.stringContaining('already') });
    expect(mock.startResearch).toHaveBeenCalledTimes(1);
  });

  it('promotes only a backed note, then drafts and accepts its brief', async () => {
    const p = ports();
    const id = await note({ title: 'Try a small physics-based visual prototype, not a graphing app', narrative: 'Chats lean to animation.\n\nNext: Sketch a physics toy.' });
    expect(await promote(id, p, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('worth knowing') });
    await db.execute(sql`UPDATE daydream_thoughts SET feedback='useful' WHERE id=${id}`);
    expect(await promote(id, p, NOW)).toMatchObject({ ok: true });
    expect(p.calls).toEqual([`intake:thought:${id}`]);

    expect(await acceptBuild(id, p, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('Draft the brief first') });
    expect(await draftBrief(id, p, NOW)).toMatchObject({ ok: true });
    const drafted = readFollow((await row(id)).proposed_actions).build?.data as { brief: { outcome: string }; acceptedAt: string | null };
    expect(drafted).toMatchObject({ brief: { outcome: 'A one-page physics toy' }, acceptedAt: null });
    expect(await acceptBuild(id, p, NOW)).toMatchObject({ ok: true });
    expect(p.calls).toContain('accept:A one-page physics toy');
    expect(await acceptBuild(id, p, NOW)).toMatchObject({ ok: true, message: 'Already accepted.' });
  });

  it('refuses everything on a note he turned down', async () => {
    const id = await note({ feedback: 'not_useful' });
    expect(await digDeeper(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('turned this note down') });
  });

  it('starts a capped prototype build — and refuses when the subscription is nearly used', async () => {
    const id = await note({ kind: 'think_build', title: 'A physics toy prototype', narrative: 'A small interactive sketch.\n\nNext: Build the toy.' });
    mock.quota.mockResolvedValueOnce({ fiveHourPct: 85, weeklyPct: 20 });
    expect(await startPrototype(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('85% used') });
    const res = await startPrototype(id, NOW);
    expect(res).toMatchObject({ ok: true, href: expect.stringMatching(/^\/jkai\/builds\//) });
    const buildId = String(readFollow((await row(id)).proposed_actions).prototype?.data.buildId);
    builds.push(buildId);
    const b = (await db.execute(sql`SELECT budget_config, git_target_config FROM jkai_builds WHERE id=${buildId}`)).rows[0] as { budget_config: { maxTotalMinutes: number; maxTokensPerHour: number }; git_target_config: unknown };
    expect(b.budget_config).toMatchObject({ maxTotalMinutes: 45, maxTokensPerHour: 1_500_000 });
    expect(b.git_target_config).toBeNull();
    expect(mock.startBuild).toHaveBeenCalledWith(buildId);
  });

  it('starts a watch from his words, refuses a second, and stops it', async () => {
    const id = await note({ kind: 'think_build', title: 'Build a home coverage watchdog', narrative: 'Hallway climate unavailable.\n\nNext: Flag unavailable heating.' });
    mock.createMonitor.mockResolvedValue({ workflowId: 'wf-1', cron: '0 */6 * * *' });
    expect(await startWatch(id, 'short', NOW)).toMatchObject({ ok: false });
    expect(await startWatch(id, 'Tell me when any heating device is unavailable for a day', NOW)).toMatchObject({ ok: true });
    expect(mock.createMonitor.mock.calls[0][0]).toContain('Tell me when any heating device is unavailable for a day');
    expect(await startWatch(id, 'Tell me when any heating device is unavailable for a day', NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('already') });
    expect(await stopWatch(id, NOW)).toMatchObject({ ok: true });
    expect(mock.deleteMonitor).toHaveBeenCalledWith('wf-1');
  });

  it('drafts a message with the number from the source, never from the model, and will not Gmail-draft without a cited address', async () => {
    const id = await note({ evidence: [{ kind: 'think-card', id: 'fetch_url:[["url","https://example.org"]]@2026-10-05', note: 'Bookings: call 07700 900123' }] });
    mock.loop.mockResolvedValue({ reply: '{"subject":"Barns Ness walk","text":"Hello, are there still places on the 16 October walk? Thanks, John"}' });
    expect(await draftMessage(id, NOW)).toMatchObject({ ok: true });
    const msg = readFollow((await row(id)).proposed_actions).message?.data as { phone: string; email: string | null };
    expect(msg).toMatchObject({ phone: '447700900123', email: null });
    expect(await gmailDraft(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('will not guess') });
  });

  it('checks Home Assistant, then refreshes only what it found, with only the two harmless services', async () => {
    const id = await note({ kind: 'think_build', title: 'Hallway heating unavailable', narrative: 'The downstairs hallway climate is unavailable.' });
    mock.tool.mockImplementation(async (name: string) => {
      if (name === 'ha_find') return { success: true, data: { entities: [{ entity_id: 'sensor.kitchen_temp', friendly_name: 'Kitchen temp' }, { entity_id: 'climate.downstairs_hallway', friendly_name: 'Downstairs Hallway', area_name: 'Hall' }] } };
      if (name === 'ha_call_service') return { success: true };
      return { success: false, error: 'unexpected' };
    });
    expect(await refreshHome(id, ['climate.downstairs_hallway'], NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('Check') });
    expect(await checkHome(id, NOW)).toMatchObject({ ok: true });
    const found = (readFollow((await row(id)).proposed_actions).home?.data as { found: Array<{ id: string }> }).found;
    expect(found[0].id).toBe('climate.downstairs_hallway'); // the device the note names comes first
    expect(await refreshHome(id, ['climate.downstairs_hallway', 'lock.front_door'], NOW)).toMatchObject({ ok: true });
    const services = mock.tool.mock.calls.filter(([n]) => n === 'ha_call_service').map(([, a]) => `${a.domain}.${a.service}:${a.entity_id}`);
    expect(services).toEqual(['homeassistant.update_entity:climate.downstairs_hallway', 'homeassistant.reload_config_entry:climate.downstairs_hallway']);
  });

  it('holds an event: diary entry plus a code-dated reminder; Undo removes both', async () => {
    await setSetting(ACT_CALENDAR_KEY, 'Home');
    const id = await note();
    mock.draft.mockResolvedValue({ kind: 'event_hold', title: 'Barns Ness geology walk', date: '2026-10-16', time: '11:00' });
    mock.tool.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'apple_calendar_create') return { success: true, data: { id: 'uid-hold', url: '', calendar: args.calendar } };
      if (name === 'schedule_tool_call_at') return { success: true };
      if (name === 'apple_calendar_list') return { success: true, data: { events: [{ id: 'https://caldav.example/uid-hold.ics', uid: 'uid-hold' }] } };
      if (name === 'apple_calendar_delete') return { success: true };
      if (name === 'cancel_scheduled_callback') return { success: true };
      return { success: false, error: 'unexpected' };
    });
    const done = await doIt(id, NOW);
    expect(done).toMatchObject({ ok: true, label: expect.stringContaining('remind you to book on Tue 13 Oct') });
    const sched = mock.tool.mock.calls.find(([n]) => n === 'schedule_tool_call_at')!;
    expect(sched[1]).toMatchObject({ fire_at_iso: '2026-10-13T08:00:00.000Z' });
    expect(await undoIt(id, NOW)).toMatchObject({ ok: true, status: 'undone' });
    expect(mock.tool.mock.calls.map(([n]) => n)).toEqual(expect.arrayContaining(['apple_calendar_delete', 'cancel_scheduled_callback']));
  });

  it('writes a week of sessions all or none', async () => {
    await setSetting(ACT_CALENDAR_KEY, 'Home');
    const id = await note({ kind: 'think_health_plan', title: 'A gentle week back', narrative: 'Runs on 12 October and 14 October, a walk on 17 October.\n\nNext: Put the three sessions in the diary.' });
    mock.draft.mockResolvedValue({ kind: 'calendar_batch', entries: [{ title: 'Easy run', date: '2026-10-12', time: null }, { title: 'Easy run', date: '2026-10-14', time: null }, { title: 'Long walk', date: '2026-10-17', time: null }] });
    let n = 0;
    mock.tool.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'apple_calendar_create') return ++n === 3 ? { success: false, error: 'calendar full' } : { success: true, data: { id: `uid-${n}`, url: `https://caldav.example/uid-${n}.ics`, calendar: args.calendar } };
      if (name === 'apple_calendar_delete') return { success: true };
      return { success: false, error: 'unexpected' };
    });
    expect(await doIt(id, NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('took the others back out') });
    expect(mock.tool.mock.calls.filter(([nm]) => nm === 'apple_calendar_delete')).toHaveLength(2);
  });

  it('a new research note replaces older unanswered notes on the same subject, and leaves answered ones', async () => {
    const day = (d: string) => new Date(`${d}T12:00:00Z`);
    const hutton = await note({ title: 'Use the remaining Hutton exhibitions as a Barns Ness follow-up', created: day('2026-10-02') });
    const nov = await note({ title: 'A bookable Barns Ness geology walk is listed for 1 November', created: day('2026-10-03') });
    const rated = await note({ title: 'Another Barns Ness walk', feedback: 'useful', created: day('2026-10-03') });
    const fresh = await note({ title: 'Book the Dunbar–Barns Ness geology walk on 16 October', created: day('2026-10-05') });
    const key = (await db.execute(sql`SELECT dedupe_key FROM daydream_thoughts WHERE id=${fresh}`)).rows[0] as { dedupe_key: string };
    expect(await supersedeOnTopic([key.dedupe_key], NOW)).toBe(2);
    expect(await row(hutton)).toMatchObject({ status: 'archived', suppressed_reason: `superseded: ${fresh}` });
    expect((await row(nov)).status).toBe('archived');
    expect((await row(rated)).status).toBe('suppressed');
    const entry = ((await row(fresh)).proposed_actions as Array<{ kind: string; label: string }>).find((a) => a.kind === 'replaces');
    expect(entry?.label).toBe('Replaces 2 earlier notes on the same subject');
  });
});
