import { describe, expect, it } from 'vitest';
import { buildBoard } from './board';
import { suggestBacklogGrooming } from './backlog-grooming';
import { renderBacklogBrief } from './grooming';
import type { BacklogItemData } from './types';
const row = (slug: string, title: string, extra: Partial<BacklogItemData> = {}): BacklogItemData => ({
  slug, title, detail: title, kind: 'feature', status: 'open', priority: 3, attempts: 0,
  createdAt: '2026-09-01', updatedAt: '2026-09-01', ...extra,
});
const board = (rows: BacklogItemData[]) => buildBoard({ backlog: rows, capabilities: [], tools: [], attemptCeiling: 4, settledLimit: null }).items;
describe('automatic grooming suggestions', () => {
  it('suggests a stable surviving request instead of circular merges', () => {
    const items = board(['a', 'b', 'c'].map((id) => row(id, 'Apple calendar event reminders')));
    const suggestions = suggestBacklogGrooming(items);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.kind === 'merge' && s.targetId === 'backlog:a')).toBe(true);
    expect(suggestBacklogGrooming([...items].reverse())).toEqual(suggestions);
  });
  it('prefers existing live functionality over a queued duplicate', () => {
    const items = board([row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders'),
      row('live', 'Apple calendar event reminders', { status: 'shipped' })]);
    expect(suggestBacklogGrooming(items).every((s) => s.kind === 'covered' && s.targetId === 'backlog:live')).toBe(true);
  });
  it('does not treat related calendar capabilities as identical requests', () => {
    expect(suggestBacklogGrooming(board([row('a', 'Apple calendar reminders'), row('b', 'Apple calendar invitations')]))).toEqual([]);
  });
  it('does not suggest removing repairs, started builds or parked requests', () => {
    const items = board([row('live', 'Apple calendar event reminders', { status: 'shipped' }),
      row('fix', 'Fix Apple calendar event reminders'), row('doctor', 'Apple calendar event reminders', { source: 'doctor' }),
      row('attempted', 'Apple calendar event reminders', { attempts: 1 }),
      row('parked', 'Apple calendar event reminders', { status: 'abandoned' })]);
    expect(suggestBacklogGrooming(items).filter((s) => s.kind === 'covered')).toEqual([]);
  });
  it('finds existing tools without backlog receipts but excludes disabled or failing tools', () => {
    const items = board([row('a', 'Apple calendar event reminders')]);
    const tool = { name: 'apple_calendar_event_reminders', enabled: true, runCount: 10, errorCount: 1 };
    expect(suggestBacklogGrooming(items, [tool])[0]).toMatchObject({ kind: 'covered', targetId: `tool:${tool.name}` });
    expect(suggestBacklogGrooming(items, [{ ...tool, enabled: false }])).toEqual([]);
    expect(suggestBacklogGrooming(items, [{ ...tool, errorCount: 10 }])).toEqual([]);
  });
  it('changes the suggestion identity when requirements change', () => {
    const items = board([row('a', 'Apple calendar event reminders'), row('b', 'Apple calendar event reminders')]);
    const first = suggestBacklogGrooming(items)[0].id;
    items.find((i) => i.slug === 'b')!.detail = 'Support all recurring event rules';
    expect(suggestBacklogGrooming(items)[0].id).not.toBe(first);
  });
  it('carries all merged requirements into the actual builder prompt', () => {
    expect(renderBacklogBrief({ title: 'Reminders', detail: 'Daily', absorbedRequirements: { original: 'Acceptance: handle leap days' } })).toContain('Acceptance: handle leap days');
  });
});

it('automates requirement-preserving merges but leaves uncertain coverage for review', () => {
  const items = board([row('a', 'Apple calendar event reminders', { status: 'shipped' }),
    row('b', 'Apple calendar event reminders', { detail: 'Support recurring leap-day exceptions' })]);
  expect(suggestBacklogGrooming(items)[0]).toMatchObject({ kind: 'covered', automatic: false });
  items.find((i) => i.slug === 'a')!.detail = 'Support recurring leap-day exceptions';
  expect(suggestBacklogGrooming(items)[0].automatic).toBe(true);
});
it('never automatically merges different delivery categories', () => {
  expect(suggestBacklogGrooming(board([row('a', 'Apple calendar event reminders', { kind: 'watch' }), row('b', 'Apple calendar event reminders')]))).toEqual([]);
});
