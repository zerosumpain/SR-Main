import { describe, expect, it } from 'vitest';
import { matchNotes, waitingOnYou, waitingReason } from './relevance';

const NOW = new Date('2026-10-28T09:00:00Z');

describe('waitingReason', () => {
  it('counts what needs him, never a plain unrated note', () => {
    expect(waitingReason({ stage: 'spotted', bucket: 'decide', commissionState: null })).toBeNull();
    expect(waitingReason({ stage: 'decide', bucket: 'decide', commissionState: 'awaiting_approval' })).toBe('commission_needs_ok');
    expect(waitingReason({ stage: 'decide', bucket: 'decide', commissionState: 'needs_attention' })).toBe('commission_needs_ok');
    expect(waitingReason({ stage: 'result', bucket: 'decide', commissionState: 'completed' })).toBe('report_back');
    expect(waitingReason({ stage: 'decide', bucket: 'decide', commissionState: null })).toBe('draft_waiting');
  });

  it('ignores work in motion and notes already done', () => {
    expect(waitingReason({ stage: 'motion', bucket: 'motion', commissionState: 'running' })).toBeNull();
    expect(waitingReason({ stage: 'result', bucket: 'done', commissionState: 'completed' })).toBeNull();
    expect(waitingReason({ stage: 'decide', bucket: 'done', commissionState: null })).toBeNull();
  });

  it('keeps the given order', () => {
    const notes = [
      { id: 'a', stage: 'spotted' as const, bucket: 'decide' as const, commissionState: null },
      { id: 'b', stage: 'result' as const, bucket: 'decide' as const, commissionState: 'completed' },
      { id: 'c', stage: 'decide' as const, bucket: 'decide' as const, commissionState: 'awaiting_approval' },
    ];
    expect(waitingOnYou(notes).map((w) => [w.note.id, w.reason])).toEqual([
      ['b', 'report_back'],
      ['c', 'commission_needs_ok'],
    ]);
  });
});

describe('matchNotes', () => {
  const note = (id: string, title: string, summary: string, daysAgo = 1) => ({
    id,
    title,
    summary,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  });

  it('matches near-duplicate wording on the title', () => {
    const notes = [
      note('rome', 'Rome hotel checkout moved to Friday', 'The booking email changed the date.'),
      note('boiler', 'Boiler pressure dropped overnight', 'Sensor shows 0.8 bar.'),
    ];
    expect(matchNotes('what about the hotel in Rome?', notes, NOW).map((n) => n.id)).toEqual(['rome']);
  });

  it('needs more than one shared summary word', () => {
    const notes = [note('a', 'Spending pattern', 'Groceries went up this month.')];
    expect(matchNotes('groceries', notes, NOW)).toEqual([]);
    expect(matchNotes('groceries spending', notes, NOW).map((n) => n.id)).toEqual(['a']);
  });

  it('ranks title matches first and drops notes outside the week', () => {
    const notes = [
      note('old', 'Boiler pressure again', 'boiler pressure', 9),
      note('summary', 'Heating', 'The boiler pressure is low.'),
      note('title', 'Boiler pressure dropped', 'Sensor reading.'),
    ];
    expect(matchNotes('boiler pressure', notes, NOW).map((n) => n.id)).toEqual(['title', 'summary']);
  });

  it('matches nothing on a filler-only query', () => {
    expect(matchNotes('what is this', [note('a', 'What is this', 'this is that')], NOW)).toEqual([]);
  });
});
