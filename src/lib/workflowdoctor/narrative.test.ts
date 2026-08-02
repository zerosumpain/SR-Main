import { describe, it, expect } from 'vitest';
import { buildDoctorStories, formatOccurrences, summariseDoctorStories } from './narrative';
import type { DoctorNarrativeInput, NarrativeFinding, NarrativeRun } from './narrative';
import { emptyPhases, type DoctorFindingData, type DoctorRunData } from './types';

// Fixtures are the real 2026-08-02 production failure distribution: the
// `icloud-cal` orphan that failed 5,053 times, the missing iCloud credential,
// and a node config carrying a key. The prose asserted below is the prose the
// page renders, so a reworded template breaks a test rather than silently
// changing what the owner reads.

function finding(patch: Partial<DoctorFindingData> = {}, key = 'wf-1:node-1:aaaaaaaaaaaa'): NarrativeFinding {
  return {
    key,
    data: {
      workflowId: 'wf-1',
      workflowName: 'canvas:icloud-new-event',
      canvasSlug: 'icloud-new-event',
      nodeId: 'node-1',
      nodeType: 'icloud-cal',
      nodeLabel: 'Fetch calendar',
      signature: 'No executor found for node type: icloud-cal',
      fixKind: 'dead-node-type',
      status: 'proposed',
      occurrences: 5053,
      firstSeen: '2026-07-26T05:00:00.000Z',
      lastSeen: '2026-08-02T05:00:00.000Z',
      lastRunId: 'run-2',
      symptom: 'Every run fails immediately — 5,053 failures in the last 7 days.',
      cause:
        "This canvas uses a node type ('icloud-cal') that no longer exists in the app, so the run dies at that node.",
      causeSource: 'signature',
      fix: "Replace it with 'apple-calendar', which looks like its replacement, then re-run.",
      lintIssues: [],
      updatedAt: '2026-08-02T05:00:00.000Z',
      ...patch,
    },
  };
}

function run(runId: string, createdAt: string, patch: Partial<DoctorRunData> = {}): NarrativeRun {
  return {
    runId,
    createdAt,
    data: {
      status: 'complete',
      trigger: 'cron',
      startedAt: createdAt,
      finishedAt: createdAt,
      phases: emptyPhases(),
      llmCalls: 2,
      tokensIn: 400,
      tokensOut: 120,
      costUsd: 0.02,
      workflowsFailing: 3,
      signaturesSeen: 6,
      autoApplyEnabled: true,
      breakerEnabled: true,
      fixesApplied: 0,
      fixesReverted: 0,
      fixesRefusedSensitive: 0,
      schedulesQuarantined: 0,
      proposalsOpened: 0,
      findingsResolved: 0,
      whatsappDelivered: true,
      actions: [],
      report: '',
      ...patch,
    },
  };
}

function input(patch: Partial<DoctorNarrativeInput> = {}): DoctorNarrativeInput {
  return { runs: [], findings: [], ...patch };
}

const RUN_LAST_NIGHT = run('run-2', '2026-08-02T05:00:00.000Z');

describe('buildDoctorStories — one card per finding', () => {
  it('names the canvas and the node, and carries the signature as evidence', () => {
    const [card] = buildDoctorStories(input({ findings: [finding()], runs: [RUN_LAST_NIGHT] }));
    expect(card.subject).toBe('canvas:icloud-new-event / Fetch calendar');
    expect(card.symptomEvidence).toContain('No executor found for node type: icloud-cal');
    expect(card.symptomEvidence).toContain('5,053 failures since 26 Jul');
    expect(card.occurrences).toBe(5053);
    expect(card.fixKindLabel).toBe('node type no longer exists');
  });

  it('passes causeSource straight through so an LLM guess renders weaker', () => {
    const [card] = buildDoctorStories(
      input({ findings: [finding({ causeSource: 'llm', fixKind: 'unclassified' })] }),
    );
    expect(card.causeSource).toBe('llm');
    expect(card.cause).toContain('icloud-cal');
  });

  it('never invents a count when none was recorded', () => {
    const [card] = buildDoctorStories(input({ findings: [finding({ occurrences: 0 })] }));
    expect(card.occurrences).toBeUndefined();
    expect(card.symptomEvidence).not.toMatch(/failure/);
    expect(JSON.stringify(card)).not.toMatch(/NaN|undefined failures/);
  });

  it('survives an empty ledger', () => {
    expect(buildDoctorStories(input())).toEqual([]);
    expect(summariseDoctorStories([])).toMatch(/nothing for the doctor to report/i);
  });
});

describe('refused_sensitive — the field NAME, never the value', () => {
  const SECRET = 'sk-or-v1-0123456789abcdef0123456789abcdef01234567';

  const refused = finding(
    {
      status: 'refused_sensitive',
      fixKind: 'secret-in-node-config',
      nodeLabel: 'Call OpenRouter',
      // A caller that passes `field=value` by mistake must still cost nothing.
      sensitiveFields: [`config.apiKey=${SECRET}`],
      symptom: 'This node holds a credential in its saved config.',
      cause: 'A value on this node matches the shape of an API key.',
      fix: 'Delete the node and recreate it.',
      causeSource: 'linter',
    },
    'wf-2:node-9:bbbbbbbbbbbb',
  );

  it('renders the field name and no part of the value', () => {
    const [card] = buildDoctorStories(input({ findings: [refused] }));
    expect(card.outcome).toContain('config.apiKey');
    expect(card.sensitiveFields).toEqual(['config.apiKey']);
    const rendered = JSON.stringify(card);
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain('sk-or-v1');
  });

  it('is a refusal, and says why editing the node is the wrong move', () => {
    const [card] = buildDoctorStories(input({ findings: [refused] }));
    expect(card.fixMode).toBe('refused');
    expect(card.note).toMatch(/republishes the OLD value/);
    expect(card.outcome).toMatch(/Nothing on this node was touched/);
    expect(card.outcomeKind).toBe('expected');
  });
});

describe('outcomeKind — measured, expected, unproven', () => {
  it('is measured ONLY when the verify count actually fell', () => {
    const [card] = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT],
        findings: [
          finding({
            status: 'auto_fixed',
            fixKind: 'enum-violation',
            verifyBefore: 3,
            verifyAfter: 1,
          }),
        ],
      }),
    );
    expect(card.outcomeKind).toBe('measured');
    expect(card.outcome).toContain('Applied automatically on 2 Aug');
    expect(card.outcome).toContain('fell from 3 to 1');
    expect(card.fixMode).toBe('auto-apply');
  });

  it('is unproven — "too early to tell" — for a fix applied with nothing run since', () => {
    const [card] = buildDoctorStories(
      input({ runs: [RUN_LAST_NIGHT], findings: [finding({ status: 'auto_fixed', fixKind: 'enum-violation' })] }),
    );
    expect(card.outcomeKind).toBe('unproven');
    expect(card.outcome).toMatch(/too early to tell/);
  });

  it('counts later runs as the weak evidence it is, still unproven', () => {
    const [card] = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT, run('run-3', '2026-08-03T05:00:00.000Z')],
        findings: [finding({ status: 'auto_fixed', fixKind: 'enum-violation' })],
      }),
    );
    expect(card.outcomeKind).toBe('unproven');
    expect(card.outcome).toContain('1 later run has not recorded it again');
    expect(card.outcome).toMatch(/weak evidence/);
  });

  it('is unproven when a fix was measured and did NOT improve the graph', () => {
    const [card] = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT],
        findings: [
          finding({
            status: 'reverted',
            fixKind: 'broken-input-ref',
            verifyBefore: 2,
            verifyAfter: 4,
          }),
        ],
      }),
    );
    expect(card.outcomeKind).toBe('unproven');
    expect(card.outcome).toContain('went from 2 to 4 instead of down');
    expect(card.outcome).toMatch(/back as it was/);
    expect(card.note).toMatch(/strictly cleaner/);
  });

  it('is expected for a proposal, and says nothing changed', () => {
    const [card] = buildDoctorStories(input({ findings: [finding()] }));
    expect(card.outcomeKind).toBe('expected');
    expect(card.fixMode).toBe('propose-only');
    expect(card.outcome).toMatch(/Nothing has been changed/);
    expect(card.outcome).toContain('5,053 failures recorded since 26 Jul');
  });

  it('will not call a signature that stopped arriving proof that the fix worked', () => {
    const [card] = buildDoctorStories(
      input({
        findings: [
          finding({
            status: 'resolved',
            lastSeen: '2026-07-30T05:00:00.000Z',
            beforeImage: { nodeId: 'node-1', version: 4, changedFields: { mode: 'read' } },
          }),
        ],
      }),
    );
    expect(card.outcomeKind).toBe('unproven');
    expect(card.outcome).toContain('not been seen since 30 Jul');
    expect(card.outcome).toMatch(/not proof the change is why/);
  });
});

describe('the circuit breaker and shadow nights', () => {
  it('says a quarantined schedule stops the retries, not the breakage', () => {
    const [card] = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT],
        findings: [
          finding({
            status: 'auto_fixed',
            fixKind: 'runaway-schedule',
            beforeImage: { nodeId: 'node-1', version: 1, changedFields: {}, scheduleId: 'sch-1' },
          }),
        ],
      }),
    );
    expect(card.outcome).toContain('schedule was switched off automatically on 2 Aug');
    expect(card.outcome).toMatch(/canvas itself is unchanged/);
    expect(card.arc.map((s) => s.label)).toContain('schedule switched off');
  });

  it('explains a mechanical fix that was only proposed because auto-apply was off', () => {
    const [card] = buildDoctorStories(
      input({
        runs: [run('run-2', '2026-08-02T05:00:00.000Z', { autoApplyEnabled: false })],
        findings: [finding({ fixKind: 'enum-violation' })],
      }),
    );
    expect(card.note).toMatch(/auto-apply was off on 2 Aug/i);
  });

  it('does not guess at a shadow night when the run record is not loaded', () => {
    const [card] = buildDoctorStories(input({ findings: [finding({ fixKind: 'enum-violation' })] }));
    expect(card.note).toBeUndefined();
  });
});

describe('ranking — what only a human can clear comes first', () => {
  it('orders refused, then fixed, then proposals loudest-first, then resolved', () => {
    const cards = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT],
        findings: [
          finding({ status: 'resolved' }, 'k-resolved'),
          finding({ status: 'proposed', occurrences: 2 }, 'k-proposed-quiet'),
          finding({ status: 'auto_fixed', fixKind: 'enum-violation' }, 'k-fixed'),
          finding({ status: 'proposed', occurrences: 5053 }, 'k-proposed-loud'),
          finding({ status: 'refused_sensitive', fixKind: 'secret-in-node-config' }, 'k-refused'),
        ],
      }),
    );
    expect(cards.map((c) => c.id)).toEqual([
      'k-refused',
      'k-fixed',
      'k-proposed-loud',
      'k-proposed-quiet',
      'k-resolved',
    ]);
  });
});

describe('summariseDoctorStories — the one-line header', () => {
  it('leads with canvases affected and counts each status once', () => {
    const stories = buildDoctorStories(
      input({
        runs: [RUN_LAST_NIGHT],
        findings: [
          finding({ status: 'auto_fixed', fixKind: 'enum-violation' }, 'k1'),
          finding({ status: 'proposed', workflowId: 'wf-2' }, 'k2'),
          finding({ status: 'proposed', workflowId: 'wf-3' }, 'k3'),
          finding({ status: 'refused_sensitive', fixKind: 'secret-in-node-config', workflowId: 'wf-3' }, 'k4'),
          finding({ status: 'resolved', workflowId: 'wf-9' }, 'k5'),
        ],
      }),
    );
    const line = summariseDoctorStories(stories);
    expect(line).toBe('3 canvases affected · 1 fixed automatically · 2 proposed · 1 needs you · 1 resolved.');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('does not count a closed finding as a live one', () => {
    const stories = buildDoctorStories(input({ findings: [finding({ status: 'resolved' })] }));
    expect(summariseDoctorStories(stories)).toBe('Nothing failing · 1 resolved.');
  });
});

describe('formatOccurrences', () => {
  it('pluralises and separates thousands', () => {
    expect(formatOccurrences(1)).toBe('1 failure');
    expect(formatOccurrences(2)).toBe('2 failures');
    expect(formatOccurrences(5053)).toBe('5,053 failures');
  });
});
