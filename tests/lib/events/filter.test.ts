import { describe, expect, it } from 'vitest';
import { matchesFilter, normaliseFilter, scheduleMatchesEvent } from '$lib/events/filter';

describe('normaliseFilter', () => {
  it('keeps well-formed clauses and drops empty ones', () => {
    expect(
      normaliseFilter([
        { key: 'text', op: 'contains', value: 'lights' },
        { key: '', op: 'equals', value: 'x' },
        { key: 'from', value: '+44' },
      ]),
    ).toEqual({
      ok: true,
      filter: [
        { key: 'text', op: 'contains', value: 'lights' },
        { key: 'from', op: 'equals', value: '+44' },
      ],
    });
  });

  it('treats absent as no filter, and refuses a non-array', () => {
    expect(normaliseFilter(undefined)).toEqual({ ok: true, filter: [] });
    expect(normaliseFilter('text=lights').ok).toBe(false);
  });

  it('refuses an unknown operator and a nested key', () => {
    expect(normaliseFilter([{ key: 'text', op: 'regex', value: 'x' }]).ok).toBe(false);
    expect(normaliseFilter([{ key: 'a.b', op: 'equals', value: 'x' }]).ok).toBe(false);
  });
});

describe('matchesFilter', () => {
  const payload = { text: 'Turn the Lights off', from: '+447700900123', count: 3, tags: ['AI', 'policy'] };

  it('matches contains case-insensitively on a top-level string', () => {
    expect(matchesFilter(payload, [{ key: 'text', op: 'contains', value: 'lights' }])).toBe(true);
    expect(matchesFilter(payload, [{ key: 'text', op: 'contains', value: 'heating' }])).toBe(false);
  });

  it('matches equals against numbers by their string form', () => {
    expect(matchesFilter(payload, [{ key: 'count', op: 'equals', value: '3' }])).toBe(true);
  });

  it('matches contains against an array element', () => {
    expect(matchesFilter(payload, [{ key: 'tags', op: 'contains', value: 'polic' }])).toBe(true);
  });

  it('requires every clause (AND), and a missing key never matches', () => {
    expect(
      matchesFilter(payload, [
        { key: 'text', op: 'contains', value: 'lights' },
        { key: 'missing', op: 'equals', value: '' },
      ]),
    ).toBe(false);
  });

  it('an empty filter matches everything', () => {
    expect(matchesFilter(payload, [])).toBe(true);
  });
});

describe('scheduleMatchesEvent', () => {
  const event = { type: 'whatsapp.inbound', payload: { text: 'lights on' }, chainDepth: 0, originWorkflowId: null };

  it('matches on type and filter', () => {
    expect(
      scheduleMatchesEvent({ eventType: 'whatsapp.inbound', filter: [{ key: 'text', op: 'contains', value: 'lights' }] }, 'wf', event),
    ).toBe(true);
    expect(
      scheduleMatchesEvent({ eventType: 'whatsapp.inbound', filter: [{ key: 'text', op: 'contains', value: 'heat' }] }, 'wf', event),
    ).toBe(false);
  });

  it('keeps the legacy workflow_completed name working for a stored schedule', () => {
    const done = { type: 'workflow.completed', payload: { workflowId: 'A' }, chainDepth: 0, originWorkflowId: 'A' };
    expect(scheduleMatchesEvent({ eventType: 'workflow_completed' }, 'B', done)).toBe(true);
    expect(scheduleMatchesEvent({ eventType: 'workflow_completed', sourceWorkflowId: 'Z' }, 'B', done)).toBe(false);
  });

  it('never starts the workflow that raised the event', () => {
    const raised = { type: 'notification.raised', payload: {}, chainDepth: 1, originWorkflowId: 'W' };
    expect(scheduleMatchesEvent({ eventType: 'notification.raised' }, 'W', raised)).toBe(false);
    expect(scheduleMatchesEvent({ eventType: 'notification.raised' }, 'X', raised)).toBe(true);
  });
});
