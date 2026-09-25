import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FixKind } from './types';

type Idea = { title: string; detail: string; kind: string; priority?: number; source?: string };
const h = vi.hoisted(() => ({ raised: [] as Idea[], existing: new Set<string>(), throws: false }));

vi.mock('$lib/selfimprove/backlog', async () => {
  const { slugifyIdea } = await import('$lib/selfimprove/types');
  return {
    addIdeas: vi.fn(async (ideas: Idea[]) => {
      if (h.throws) throw new Error('datastore down');
      const created: string[] = [];
      for (const i of ideas) {
        const slug = slugifyIdea(i.title);
        if (h.existing.has(slug)) continue;
        h.raised.push(i);
        created.push(slug);
      }
      return created;
    }),
  };
});

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
  h.existing = new Set();
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

describe('escalateFindings', () => {
  it('queues a backlog feature a human can read, from the doctor channel', async () => {
    const raised = await escalateFindings([finding('dead-node-type')]);
    expect(raised).toEqual(['Morning briefing / Read the diary (dead-node-type)']);
    expect(h.raised[0]).toMatchObject({ kind: 'feature', source: 'doctor', priority: 1 });
    expect(h.raised[0].title).toBe('Fix Morning briefing / Read the diary (dead-node-type)');
    expect(h.raised[0].detail).toContain('Migrate it to apple-calendar');
  });

  it('queues a persistent failure the same way', async () => {
    await escalateFindings([finding('unclassified', 5)]);
    expect(h.raised[0]).toMatchObject({ kind: 'feature', source: 'doctor' });
  });

  it('queues nothing for the kinds it leaves alone', async () => {
    expect(await escalateFindings([finding('runaway-schedule'), finding('missing-credential')])).toEqual([]);
    expect(h.raised).toEqual([]);
  });

  it('reports only what was NEWLY queued — a standing defect is queued once', async () => {
    h.existing.add('fix-morning-briefing-read-the-diary-dead-node-type');
    expect(await escalateFindings([finding('dead-node-type')])).toEqual([]);
  });

  it('is soft when the backlog cannot be written', async () => {
    h.throws = true;
    expect(await escalateFindings([finding('dead-node-type')])).toEqual([]);
  });

  it('names the run when the node has no label', () => {
    expect(
      escalationIdentifier({ workflowName: 'W', nodeType: null, nodeLabel: null, fixKind: 'unclassified' }),
    ).toBe('W / the run (unclassified)');
  });
});
