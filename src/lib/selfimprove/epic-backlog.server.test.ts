import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogItemData, EpicData } from './types';
const h = vi.hoisted(() => ({ backlog: [] as BacklogItemData[], epics: [] as EpicData[], writes: 0 }));
vi.mock('./backlog', () => ({ MAX_ATTEMPTS: 4,
  listBacklog: vi.fn(async () => h.backlog),
  getBacklogItem: vi.fn(async (slug: string) => h.backlog.find((i) => i.slug === slug) ?? null),
  setParked: vi.fn(async (slug: string, parked: boolean) => { const row = h.backlog.find((i) => i.slug === slug)!; row.status = parked ? 'abandoned' : 'open'; if (!parked) delete row.foldedInto; }),
  foldItems: vi.fn(async (slugs: string[], into: string) => { for (const row of h.backlog) if (slugs.includes(row.slug) && row.slug !== into) { row.status = 'abandoned'; row.foldedInto = into; } }),
  setPriority: vi.fn(async (slug: string, priority: number) => { h.backlog.find((i) => i.slug === slug)!.priority = priority; }),
}));
vi.mock('./epics', () => ({ listEpics: vi.fn(async () => h.epics) }));
vi.mock('./seed-apis', () => ({ ensureSystemCollections: vi.fn() }));
vi.mock('./context', () => ({ loadCustomToolHealth: vi.fn(async () => []) }));
vi.mock('$lib/daydream/appetite/store', () => ({ listCapabilities: vi.fn(async () => []) }));
vi.mock('$lib/datastore', () => ({
  getRecordByKey: vi.fn(async (_: string, slug: string) => ({ data: h.epics.find((e) => e.slug === slug) })),
  upsertRecord: vi.fn(async (collection: string, record: { data: EpicData | BacklogItemData }) => {
    if (collection === 'improvement_backlog') { h.backlog = [...h.backlog.filter((e) => e.slug !== record.data.slug), record.data as BacklogItemData]; return; }
    h.writes++; h.epics = [...h.epics.filter((e) => e.slug !== record.data.slug), record.data as EpicData];
  }),
}));
import { loadEpicBacklog, updateEpic, decideBacklogGrooming, overrideBacklogGrooming } from './epic-backlog.server';
import { listBacklog } from './backlog';
function row(slug: string, title: string): BacklogItemData {
  return { slug, title, detail: 'Synthetic requirement', kind: 'feature', status: 'open', priority: 3, attempts: 0, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
}
beforeEach(() => { h.backlog = []; h.epics = []; h.writes = 0; vi.clearAllMocks(); });
describe('automatic epic persistence', () => {
  it('assigns every item, persists memberships and does not rewrite an unchanged backlog', async () => {
    h.backlog = [row('a', 'Apple calendar sync'), row('b', 'iCloud calendar reminders'), row('c', 'Tide forecasts')];
    const original = structuredClone(h.backlog);
    const first = await loadEpicBacklog();
    expect(first).toHaveLength(2);
    expect(h.epics.flatMap((e) => e.deliverableIds)).toHaveLength(3);
    const writes = h.writes;
    expect(await loadEpicBacklog()).toEqual(first);
    expect(h.writes).toBe(writes);
    expect(h.backlog).toEqual(original);
  });
  it('automatically absorbs future arrivals into the saved epic and retains its edited definition', async () => {
    h.backlog = [row('a', 'Apple Calendar sync')];
    const [epic] = await loadEpicBacklog();
    await updateEpic(epic.slug, 'Family calendar', 'Keep everyone informed', 1);
    h.backlog.push(row('b', 'iCloud calendar reminders'));
    const [next] = await loadEpicBacklog();
    expect(next).toMatchObject({ slug: epic.slug, title: 'Family calendar', summary: 'Keep everyone informed', priority: 1 });
    expect(next.deliverables).toHaveLength(2);
  });
  it('fails closed on a source read error without writing partial memberships', async () => {
    vi.mocked(listBacklog).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(loadEpicBacklog()).rejects.toThrow('database unavailable');
    expect(listBacklog).toHaveBeenCalledWith(undefined, { strict: true });
    expect(h.writes).toBe(0);
  });
});

describe('grooming decisions', () => {
  it('persists keep decisions across reloads', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')];
    const [epic] = await loadEpicBacklog();
    await decideBacklogGrooming(epic.suggestions![0].id, 'keep');
    expect((await loadEpicBacklog())[0].suggestions).toEqual([]);
    expect(h.backlog.every((i) => i.status === 'open')).toBe(true);
  });
  it('preserves complete requirements before retiring the duplicate', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')];
    h.backlog[1].detail = 'Must handle leap days and recurring exceptions';
    const [epic] = await loadEpicBacklog();
    await decideBacklogGrooming(epic.suggestions![0].id, 'apply');
    expect(h.backlog.find((i) => i.slug === 'a')!.absorbedRequirements!.b).toContain('leap days');
    expect(h.backlog.find((i) => i.slug === 'b')).toMatchObject({ status: 'abandoned', foldedInto: 'a' });
    expect((await loadEpicBacklog())[0].suggestions).toEqual([]);
  });
  it('parks a covered request while preserving the shipped feature', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), { ...row('b', 'Apple calendar event reminders'), status: 'shipped' }];
    const [epic] = await loadEpicBacklog();
    await decideBacklogGrooming(epic.suggestions![0].id, 'apply');
    expect(h.backlog[0].status).toBe('abandoned');
    expect(h.backlog[1].status).toBe('shipped');
  });
  it('rejects stale decisions after a builder starts', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')];
    const [epic] = await loadEpicBacklog();
    h.backlog[1].attempts = 1;
    await expect(decideBacklogGrooming(epic.suggestions![0].id, 'apply')).rejects.toThrow('Suggestion changed');
    expect(h.backlog.every((i) => i.status === 'open')).toBe(true);
  });
});

describe('automatic grooming and overrides', () => {
  it('records an automatic merge and restores it without merging again', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')];
    const [epic] = await loadEpicBacklog();
    await decideBacklogGrooming(epic.suggestions![0].id, 'apply', 'engine');
    expect((await loadEpicBacklog())[0].groomingHistory![0]).toMatchObject({ by: 'engine', state: 'applied' });
    await overrideBacklogGrooming('backlog:b', true);
    const [restored] = await loadEpicBacklog();
    expect(restored.groomingOverrides).toContain('backlog:b');
    expect(restored.suggestions).toEqual([]);
    expect(h.backlog.find((i) => i.slug === 'b')).toMatchObject({ status: 'open' });
    expect(h.backlog.find((i) => i.slug === 'b')!.foldedInto).toBeUndefined();
    expect(h.backlog.find((i) => i.slug === 'a')!.absorbedRequirements).toEqual({});
    expect(restored.groomingHistory![0].state).toBe('undone');
    await overrideBacklogGrooming('backlog:b', false);
    expect((await loadEpicBacklog())[0].suggestions).toHaveLength(1);
  });
  it('retains the override when another similar idea arrives', async () => {
    h.backlog = [row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')];
    await overrideBacklogGrooming('backlog:b', true);
    h.backlog.push(row('c', 'Apple calendar event reminders'));
    const suggestions = (await loadEpicBacklog())[0].suggestions!;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ itemId: 'backlog:c', targetId: 'backlog:a' });
  });
});
