import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FixKind } from './types';

const h = vi.hoisted(() => ({ raised: [] as Array<{ kind: string; identifier: string; detail?: string | null }> }));

vi.mock('$lib/daydream/faults', () => ({
  raiseFault: vi.fn(async (input: { kind: string; identifier: string; detail?: string | null }) => {
    h.raised.push(input);
  }),
}));

import { escalateFindings, escalationIdentifier, shouldEscalate, ESCALATE_AFTER } from './escalate';

const finding = (fixKind: FixKind, occurrences = 10) => ({
  workflowId: 'w1',
  workflowName: 'Morning briefing',
  nodeId: 'n1',
  nodeType: 'icloud-cal',
  nodeLabel: 'Read the diary',
  fixKind,
  occurrences,
  symptom: 'It failed every run.',
  cause: 'The node type is not in the registry.',
  fix: 'Migrate it to apple-calendar.',
});

beforeEach(() => {
  h.raised = [];
  vi.clearAllMocks();
});

describe('shouldEscalate', () => {
  it('always escalates a dead node type — the graph can never run again', () => {
    expect(shouldEscalate({ fixKind: 'dead-node-type', occurrences: 1 })).toBe(true);
  });

  it('leaves the doctor its own lanes', () => {
    // Config edits it can make itself.
    expect(shouldEscalate({ fixKind: 'unknown-config-key', occurrences: 99 })).toBe(false);
    expect(shouldEscalate({ fixKind: 'enum-violation', occurrences: 99 })).toBe(false);
    // The circuit breaker's lane.
    expect(shouldEscalate({ fixKind: 'runaway-schedule', occurrences: 99 })).toBe(false);
  });

  it('refuses what needs a person with a card or a password', () => {
    for (const k of ['missing-credential', 'provider-limit', 'expired-oauth', 'permission-denied'] as FixKind[]) {
      expect(shouldEscalate({ fixKind: k, occurrences: 99 })).toBe(false);
    }
  });

  it('waits for a defect to persist before calling it work', () => {
    expect(shouldEscalate({ fixKind: 'unclassified', occurrences: ESCALATE_AFTER - 1 })).toBe(false);
    expect(shouldEscalate({ fixKind: 'unclassified', occurrences: ESCALATE_AFTER })).toBe(true);
  });
});

describe('escalateFindings', () => {
  it('raises a workflow_dead_node fault a human can read', async () => {
    const raised = await escalateFindings([finding('dead-node-type')]);
    expect(raised).toEqual(['Morning briefing / Read the diary (dead-node-type)']);
    expect(h.raised[0].kind).toBe('workflow_dead_node');
    expect(h.raised[0].detail).toContain('Migrate it to apple-calendar');
  });

  it('raises everything else as workflow_failing', async () => {
    await escalateFindings([finding('unclassified', 5)]);
    expect(h.raised[0].kind).toBe('workflow_failing');
  });

  it('raises nothing for the kinds it leaves alone', async () => {
    expect(await escalateFindings([finding('runaway-schedule'), finding('missing-credential')])).toEqual([]);
    expect(h.raised).toEqual([]);
  });

  it('names the run when the node has no label', () => {
    expect(
      escalationIdentifier({ workflowName: 'W', nodeType: null, nodeLabel: null, fixKind: 'unclassified' }),
    ).toBe('W / the run (unclassified)');
  });
});
