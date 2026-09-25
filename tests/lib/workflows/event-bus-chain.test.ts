import { describe, it, expect, vi, beforeEach } from 'vitest';

// The dispatcher must start runs through the SHARED start path, refuse the two
// ways an event turns into a loop (a workflow triggering itself, an unbounded
// A→B→A chain), and honour the payload filter on a schedule.

const state = vi.hoisted(() => ({
  schedules: [] as Array<{ id: string; workflowId: string; type: string; enabled: boolean; config: Record<string, unknown> }>,
}));

vi.mock('$lib/db/schema', () => ({ workflowSchedules: { type: 'type', enabled: 'enabled' } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => state.schedules }) }) },
}));

const startTriggeredRun = vi.hoisted(() => vi.fn(async () => 'run-x'));
vi.mock('$lib/workflows/start-run', () => ({ startTriggeredRun }));
const markDispatched = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/events/store', () => ({ markDispatched, recordPlatformEvent: async () => true }));

import { handlePlatformEvent, MAX_CHAIN_DEPTH } from '$lib/workflows/event-bus';

beforeEach(() => {
  startTriggeredRun.mockClear();
  markDispatched.mockClear();
  state.schedules = [
    { id: 's-self', workflowId: 'A', type: 'event', enabled: true, config: { eventType: 'workflow_completed' } },
    { id: 's-b', workflowId: 'B', type: 'event', enabled: true, config: { eventType: 'workflow.completed', sourceWorkflowId: 'A' } },
    {
      id: 's-lights',
      workflowId: 'L',
      type: 'event',
      enabled: true,
      config: { eventType: 'whatsapp.inbound', filter: [{ key: 'text', op: 'contains', value: 'lights' }] },
    },
  ];
});

const started = () => startTriggeredRun.mock.calls.map((c) => (c as unknown[])[0]);

describe('event-bus dispatch', () => {
  it('never starts the workflow whose completion it is', async () => {
    await handlePlatformEvent({ type: 'workflow.completed', payload: { workflowId: 'A', runId: 'r1' }, originWorkflowId: 'A' });
    expect(started()).toEqual(['B']);
  });

  it('stops a chain at MAX_CHAIN_DEPTH', async () => {
    await handlePlatformEvent({
      type: 'workflow.completed',
      payload: { workflowId: 'A', runId: 'r1' },
      chainDepth: MAX_CHAIN_DEPTH,
      originWorkflowId: 'A',
    });
    expect(startTriggeredRun).not.toHaveBeenCalled();
  });

  it('passes the next depth on to the run it starts, with the event as input', async () => {
    await handlePlatformEvent({
      id: 'ev-1',
      type: 'workflow.completed',
      payload: { workflowId: 'A', runId: 'r1' },
      chainDepth: 2,
      originWorkflowId: 'A',
      persisted: Promise.resolve(true),
    });
    expect(startTriggeredRun).toHaveBeenCalledWith(
      'B',
      { event: { workflowId: 'A', runId: 'r1' }, eventType: 'workflow.completed', eventId: 'ev-1' },
      { label: 'event-bus', chainDepth: 3 },
    );
    expect(markDispatched).toHaveBeenCalledWith('ev-1');
  });

  it('applies the payload filter: "whatsapp.inbound where text contains lights"', async () => {
    await handlePlatformEvent({ type: 'whatsapp.inbound', payload: { text: 'Lights off please' } });
    expect(started()).toEqual(['L']);
    startTriggeredRun.mockClear();
    await handlePlatformEvent({ type: 'whatsapp.inbound', payload: { text: 'what is the weather' } });
    expect(startTriggeredRun).not.toHaveBeenCalled();
  });

  it('does not stamp an event whose row never landed', async () => {
    await handlePlatformEvent({ id: 'ev-2', type: 'whatsapp.inbound', payload: {}, persisted: Promise.resolve(false) });
    expect(markDispatched).not.toHaveBeenCalled();
  });
});
