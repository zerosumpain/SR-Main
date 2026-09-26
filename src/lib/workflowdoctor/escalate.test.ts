import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FixKind } from './types';

type Idea = { title: string; detail: string; kind: string; priority?: number; source?: string; ref?: string };
const h = vi.hoisted(() => ({
  queued: [] as Idea[],
  outcome: 'added' as 'added' | 'merged' | 'capped' | 'skipped',
  throws: false,
}));

// The backlog's intake is the one door (D3). Its dedup is tested in
// backlog.test.ts; here only what the doctor hands it, and what it reports.
vi.mock('$lib/selfimprove/backlog', () => ({
  intakeIdeas: vi.fn(async (ideas: Idea[]) => {
    if (h.throws) throw new Error('datastore down');
    h.queued.push(...ideas);
    return { added: [], merged: [], capped: 0, outcomes: ideas.map(() => h.outcome) };
  }),
}));

import { escalateFindings, escalationIdea, escalationIdentifier, shouldEscalate, ESCALATE_AFTER } from './escalate';

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
  h.queued = [];
  h.outcome = 'added';
  h.throws = false;
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

describe('escalateFindings — straight onto the backlog', () => {
  it('queues a dead node as a feature a human can read, from the doctor', async () => {
    const raised = await escalateFindings([finding('dead-node-type')]);
    expect(raised).toEqual(['Morning briefing / Read the diary (dead-node-type)']);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]).toMatchObject({
      // The retired fault feed's wording, so an item it queued is cited, not doubled.
      title: 'Fix Morning briefing / Read the diary (dead-node-type)',
      kind: 'feature',
      source: 'doctor',
      priority: 1,
      ref: 'doctor:w1/n1/dead-node-type',
    });
    expect(h.queued[0].detail).toContain('Migrate it to apple-calendar');
    expect(h.queued[0].detail).toContain('10 runs');
  });

  it('queues everything else it escalates the same way, at priority 1', () => {
    expect(escalationIdea(finding('unclassified', 5))).toMatchObject({ kind: 'feature', priority: 1 });
    expect(escalationIdea({ ...finding('dead-node-type'), occurrences: 1 }).priority).toBe(1);
  });

  it('reports a finding merged into an item already queued as escalated', async () => {
    h.outcome = 'merged';
    expect(await escalateFindings([finding('unclassified', 5)])).toHaveLength(1);
  });

  it('does not report a finding the intake capped or could not read', async () => {
    h.outcome = 'capped';
    expect(await escalateFindings([finding('unclassified', 5)])).toEqual([]);
  });

  it('queues nothing for the kinds it leaves alone', async () => {
    expect(await escalateFindings([finding('runaway-schedule'), finding('missing-credential')])).toEqual([]);
    expect(h.queued).toEqual([]);
  });

  it('is soft — an unwritable backlog costs the doctor nothing', async () => {
    h.throws = true;
    await expect(escalateFindings([finding('dead-node-type')])).resolves.toEqual([]);
  });

  it('names the run when the node has no label', () => {
    expect(
      escalationIdentifier({ workflowName: 'W', nodeType: null, nodeLabel: null, fixKind: 'unclassified' }),
    ).toBe('W / the run (unclassified)');
  });
});
