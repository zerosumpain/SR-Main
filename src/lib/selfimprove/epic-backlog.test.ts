import { describe, expect, it } from 'vitest';
import { buildBoard } from './board';
import { buildEpicBacklog } from './epic-backlog';
import type { BacklogItemData, EpicData } from './types';

function row(slug: string, title: string, extra: Partial<BacklogItemData> = {}): BacklogItemData {
  return { slug, title, detail: `Deliver ${title}`, kind: 'feature', status: 'open', priority: 3, attempts: 0,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...extra };
}
const board = (backlog: BacklogItemData[]) => buildBoard({ backlog, capabilities: [], tools: [], attemptCeiling: 4 }).items;
function saved(slug: string, ids: string[]): EpicData {
  return { slug, label: 'Calendar', deliverableIds: ids, automatic: true, memberSlugs: [], openSlugs: [], shippedSlugs: [],
    status: 'accepted', keywords: [], score: 0, components: {}, servedCount: 0, createdAt: '', updatedAt: '' };
}

describe('automatic epic backlog', () => {
  it('combines Apple and iCloud calendar functions across delivery categories', () => {
    const rows = ['Apple calendar sync', 'iCloud calendar reminders', 'Apple Calendar conflicts', 'iCloud calendar recurring events', 'Apple calendar invitations']
      .map((title, i) => row(`c${i}`, title, { kind: i === 1 ? 'tool' : 'feature' }));
    const epics = buildEpicBacklog(board([...rows, row('other', 'Apple music playlists')]));
    expect(epics).toHaveLength(2);
    const calendar = epics.find((e) => e.title === 'Apple Calendar integration')!;
    expect(calendar.deliverables).toHaveLength(5);
    expect(calendar.categories).toEqual(['feature', 'tool']);
    expect(calendar.deliverables.every((d) => d.backlogStatus === 'open')).toBe(true);
  });
  it('automatically creates single-deliverable epics for unrelated work', () => {
    const epics = buildEpicBacklog(board([row('a', 'Forecast rainfall'), row('b', 'Track bank balance')]));
    expect(epics).toHaveLength(2);
    expect(epics.every((e) => e.deliverables.length === 1)).toBe(true);
  });
  it('retains an epic identity and definition when a related request arrives', () => {
    const old = saved('stable-calendar', ['backlog:a']); old.ownerTitle = 'A better family calendar'; old.summary = 'Keep everyone informed';
    const epics = buildEpicBacklog(board([row('a', 'Apple calendar sync'), row('b', 'iCloud calendar notifications')]), [old]);
    expect(epics).toHaveLength(1);
    expect(epics[0]).toMatchObject({ slug: 'stable-calendar', title: old.ownerTitle, summary: old.summary });
    expect(epics[0].deliverables).toHaveLength(2);
  });
  it('includes proposed capabilities and avoids linked capability duplicates', () => {
    const b = buildBoard({ backlog: [row('a', 'Apple Calendar sync', { capabilitySlug: 'claimed' })], tools: [], attemptCeiling: 4,
      capabilities: ['claimed', 'new'].map((slug) => ({ slug, kind: 'tool', title: 'iCloud calendar conflicts', need: 'Resolve overlaps', status: 'proposed', score: 1, lane: null, outcome: null, outcomeRef: null, backlogSlug: null, evidence: [], lastSeenAt: '2026-09-01' })) });
    const epics = buildEpicBacklog(b.items);
    expect(epics).toHaveLength(1);
    expect(epics[0].deliverables.map((i) => i.id).sort()).toEqual(['backlog:a', 'capability:new']);
  });
  it('preserves a capability epic when intake replaces it with a backlog record', () => {
    const epics = buildEpicBacklog(board([row('new', 'Apple calendar sync', { capabilitySlug: 'lead' })]), [saved('stable', ['capability:lead'])]);
    expect(epics[0].slug).toBe('stable');
  });
  it('shows legacy merged sources as deliverables without duplicating their combined build', () => {
    const items = board([row('combined', 'Epic: Apple Calendar sync', { mergedBrief: 'Original requirements', epicSlug: 'old' }),
      row('a', 'Apple Calendar sync', { status: 'abandoned', foldedInto: 'combined', epicSlug: 'old' }),
      row('b', 'iCloud calendar reminders', { status: 'abandoned', foldedInto: 'combined', epicSlug: 'old' })]);
    const epics = buildEpicBacklog(items, [saved('old', [])]);
    expect(epics).toHaveLength(1);
    expect(epics[0].deliverables.map((d) => d.slug)).toEqual(['a', 'b']);
    expect(epics[0].stage).not.toBe('parked');
    expect(epics[0].combinedDeliveries.map((i) => i.slug)).toEqual(['combined']);
  });
  it('does not label partially delivered epics as complete', () => {
    const epics = buildEpicBacklog(board([row('a', 'Apple Calendar sync', { status: 'shipped' }), row('b', 'iCloud calendar reminders')]));
    expect(epics[0].stage).toBe('accepted');
  });
});
