import { describe, it, expect } from 'vitest';
import {
  canvasSlugOf,
  cronExprOf,
  deadTypeFragments,
  dominantSignature,
  evaluateRunaway,
  groupFailures,
  isInfraNoise,
  pickSuccessor,
  signatureOf,
  type FailureRow,
  type ScheduleRunSample,
  type SuccessorCandidate,
} from './triage';
import { WORK_CAPS } from './types';

const WF = 'wf-1';
const OTHER_WF = 'wf-2';

function row(patch: Partial<FailureRow> = {}): FailureRow {
  return {
    runId: 'run-1',
    workflowId: WF,
    workflowName: 'canvas:morning-briefing',
    level: 'node',
    nodeId: 'node-a',
    nodeType: 'llm-call',
    nodeLabel: 'Draft',
    error: 'Tavily API key not configured',
    at: '2026-08-01T05:00:00.000Z',
    ...patch,
  };
}

/** N runs, newest first, all failed with the same error. */
function failedRuns(n: number, error: string, prefix = 'run'): ScheduleRunSample[] {
  return Array.from({ length: n }, (_, i) => ({
    runId: `${prefix}-${i}`,
    status: 'failed',
    error,
  }));
}

describe('noise exclusion — infrastructure, not workflow defects', () => {
  it('drops the heartbeat reaper on its prefix, whatever it appends', () => {
    expect(
      isInfraNoise('r1', 'abandoned: heartbeat stale (engine crashed, restarted, or run wedged)'),
    ).toBe(true);
    expect(isInfraNoise('r1', 'abandoned: heartbeat stale')).toBe(true);
  });

  it('drops an explicit cancel, but only on an exact match', () => {
    expect(isInfraNoise('r1', 'Cancelled by user')).toBe(true);
    expect(isInfraNoise('r1', '  Cancelled by user  ')).toBe(true);
    // A longer message that merely starts the same way is a real error.
    expect(isInfraNoise('r1', 'Cancelled by user policy: quota node refused')).toBe(false);
  });

  it('drops the mid-run abort wherever it appears in the message', () => {
    expect(isInfraNoise('r1', 'Node xyz failed: aborted: run cancelled')).toBe(true);
  });

  it('drops the deploy drain', () => {
    expect(isInfraNoise('r1', 'Engine is shutting down (draining)')).toBe(true);
    expect(isInfraNoise('r1', 'llm-call: Engine is shutting down (draining) mid-call')).toBe(true);
  });

  it('drops sub-workflow runs, which surface through their parent', () => {
    expect(isInfraNoise('sub-run-9-abc12345', 'Tavily API key not configured')).toBe(true);
  });

  it('drops an empty error, which carries no signature to group on', () => {
    expect(isInfraNoise('r1', null)).toBe(true);
    expect(isInfraNoise('r1', '   ')).toBe(true);
  });

  it('keeps every real failure from the production distribution', () => {
    for (const e of [
      'No executor found for node type: icloud-cal',
      'iCloud Calendar credential is required. Add one at /admin/integrations.',
      'Blocked unsafe expression token: computed member access',
      'Node abc (llm-call) timed out after 300s',
      'Gmail token refresh failed: invalid_grant',
    ]) {
      expect(isInfraNoise('r1', e), e).toBe(false);
    }
  });

  it('excludes every noise pattern from the grouped output', () => {
    const { signatures, totalFailures } = groupFailures([
      row({ runId: 'r1', error: 'abandoned: heartbeat stale (engine crashed)' }),
      row({ runId: 'r2', error: 'Cancelled by user' }),
      row({ runId: 'r3', error: 'Node xyz failed: aborted: run cancelled' }),
      row({ runId: 'r4', error: 'Engine is shutting down (draining)' }),
      row({ runId: 'sub-r5-aaa', error: 'Tavily API key not configured' }),
      row({ runId: 'r6', error: 'Tavily API key not configured' }),
    ]);
    expect(totalFailures).toBe(1);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].signature).toBe('Tavily API key not configured');
    expect(signatures[0].lastRunId).toBe('r6');
  });
});

describe('grouping — keyed on (workflowId, nodeId, signature), never signature alone', () => {
  it('keeps two nodes in the same canvas apart even on an identical error', () => {
    const { signatures } = groupFailures([
      row({ runId: 'r1', nodeId: 'node-a' }),
      row({ runId: 'r2', nodeId: 'node-b', nodeLabel: 'Summarise' }),
    ]);
    expect(signatures).toHaveLength(2);
    expect(signatures.map((s) => s.nodeId).sort()).toEqual(['node-a', 'node-b']);
  });

  it('keeps two canvases apart even on an identical node id and error', () => {
    const { signatures, workflowsFailing } = groupFailures([
      row({ runId: 'r1', workflowId: WF }),
      row({ runId: 'r2', workflowId: OTHER_WF, workflowName: 'canvas:inbox-triage' }),
    ]);
    expect(signatures).toHaveLength(2);
    expect(workflowsFailing).toBe(2);
  });

  it('does not merge distinct errors that share the first 80 characters', () => {
    // extractSignature truncates at 80, so these two collide as strings. Only
    // the node id keeps them apart — which is the whole reason for the key.
    const prefix = 'Prompt template references unresolved: '.padEnd(80, 'x');
    const { signatures } = groupFailures([
      row({ runId: 'r1', nodeId: 'node-a', error: `${prefix}input.results` }),
      row({ runId: 'r2', nodeId: 'node-b', error: `${prefix}input.summary` }),
    ]);
    expect(signatures[0].signature).toBe(signatures[1].signature);
    expect(signatures).toHaveLength(2);
  });

  it('accumulates the same failure across runs, tracking first/last seen', () => {
    const { signatures } = groupFailures([
      row({ runId: 'r1', at: '2026-08-01T05:00:00.000Z' }),
      row({ runId: 'r2', at: '2026-07-28T05:00:00.000Z' }),
      row({ runId: 'r3', at: '2026-08-02T05:00:00.000Z' }),
    ]);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].count).toBe(3);
    expect(signatures[0].firstSeen).toBe('2026-07-28T05:00:00.000Z');
    expect(signatures[0].lastSeen).toBe('2026-08-02T05:00:00.000Z');
    expect(signatures[0].lastRunId).toBe('r3');
  });

  it('separates a run-level failure from a node-level one in the same canvas', () => {
    const { signatures } = groupFailures([
      row({ runId: 'r1', level: 'run', nodeId: null, nodeType: null, nodeLabel: null, error: 'No executor found for node type: icloud-cal' }),
      row({ runId: 'r1' }),
    ]);
    expect(signatures).toHaveLength(2);
    expect(signatures.find((s) => s.level === 'run')?.nodeId).toBeNull();
  });

  it('flags below-threshold signatures rather than hiding them', () => {
    const { signatures } = groupFailures(
      [
        row({ runId: 'r1', nodeId: 'node-a' }),
        row({ runId: 'r2', nodeId: 'node-a' }),
        row({ runId: 'r3', nodeId: 'node-b' }),
      ],
      { minOccurrences: 2 },
    );
    const byNode = Object.fromEntries(signatures.map((s) => [s.nodeId, s]));
    expect(byNode['node-a'].actionable).toBe(true);
    expect(byNode['node-b'].actionable).toBe(false);
    expect(byNode['node-b'].count).toBe(1);
  });

  it('ranks by occurrence count and caps the list', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row({ runId: `a${i}`, nodeId: 'node-a' })),
      ...Array.from({ length: 3 }, (_, i) => row({ runId: `b${i}`, nodeId: 'node-b' })),
      row({ runId: 'c0', nodeId: 'node-c' }),
    ];
    const { signatures } = groupFailures(rows, { maxSignatures: 2 });
    expect(signatures.map((s) => s.nodeId)).toEqual(['node-a', 'node-b']);
    expect(signatures[0].count).toBe(5);
  });

  it('counts every failing workflow even when the triage cap drops some', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ runId: `r${i}`, workflowId: `wf-${i}`, workflowName: `canvas:c${i}` }),
    );
    const { signatures, workflowsFailing } = groupFailures(rows, { maxWorkflows: 2 });
    expect(signatures).toHaveLength(2);
    expect(workflowsFailing).toBe(6);
  });

  it('derives the canvas slug, and null for a non-canvas workflow', () => {
    expect(canvasSlugOf('canvas:morning-briefing')).toBe('morning-briefing');
    expect(canvasSlugOf('Gmail watcher')).toBeNull();
    const { signatures } = groupFailures([row({ workflowName: 'Gmail watcher' })]);
    expect(signatures[0].canvasSlug).toBeNull();
  });
});

describe('redaction — the finding record is a republishing surface', () => {
  it('scrubs a credential out of the signature before it is ever grouped', () => {
    const sig = signatureOf('OpenRouter rejected key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345');
    expect(sig).not.toContain('sk-or-v1-abcdefghijklmnop');
    expect(sig).toContain('[redacted:api-key]');
  });

  it('scrubs the raw error kept as a page example', () => {
    const { signatures } = groupFailures([
      row({ error: 'auth failed for +447359228511 using sk-or-v1-abcdefghijklmnopqrstuvwxyz012345' }),
    ]);
    const blob = JSON.stringify(signatures);
    expect(blob).not.toContain('sk-or-v1-abcdefghijklmnop');
    expect(blob).not.toContain('447359228511');
  });

  it('groups two failures that differ only by the secret into one signature', () => {
    const { signatures } = groupFailures([
      row({ runId: 'r1', error: 'bad key sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      row({ runId: 'r2', error: 'bad key sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    ]);
    expect(signatures).toHaveLength(1);
    expect(signatures[0].count).toBe(2);
  });
});

describe('runaway schedules — the circuit breaker', () => {
  const need = WORK_CAPS.breakerConsecutiveFailures;
  const DEAD = 'No executor found for node type: icloud-cal';

  it('qualifies on ten identical consecutive failures with no successes', () => {
    const v = evaluateRunaway({
      recent: failedRuns(need, DEAD),
      windowCounts: { failed: 3789 },
    });
    expect(v.qualifies).toBe(true);
    expect(v.consecutiveFailures).toBe(need);
    expect(v.signature).toBe(DEAD);
  });

  it('does NOT qualify when a run succeeded inside the window', () => {
    const v = evaluateRunaway({
      recent: failedRuns(need, DEAD),
      windowCounts: { failed: 40, completed: 1 },
    });
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/succeeded inside the window/);
  });

  it('treats completed_with_errors as a success — the canvas still did work', () => {
    const v = evaluateRunaway({
      recent: failedRuns(need, DEAD),
      windowCounts: { failed: 40, completed_with_errors: 2 },
    });
    expect(v.qualifies).toBe(false);
  });

  it('does NOT qualify when it is failing ten different ways', () => {
    const recent = Array.from({ length: need }, (_, i) => ({
      runId: `r${i}`,
      status: 'failed',
      error: `Node ${i} blew up in its own special way number ${i}`,
    }));
    const v = evaluateRunaway({ recent, windowCounts: { failed: need } });
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/different ways/);
  });

  it('does NOT qualify on fewer than the required consecutive failures', () => {
    const v = evaluateRunaway({
      recent: failedRuns(need - 1, DEAD),
      windowCounts: { failed: need - 1 },
    });
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/needs 10/);
  });

  it('does NOT qualify when a non-failed run sits inside the last N', () => {
    const recent = failedRuns(need, DEAD);
    recent[3] = { runId: 'r3', status: 'completed', error: null };
    const v = evaluateRunaway({ recent, windowCounts: { failed: need - 1 } });
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/not failed/);
  });

  it('tolerates a minority of reaper noise but never lets it be the signature', () => {
    const recent = failedRuns(need, DEAD);
    recent[0] = { runId: 'r0', status: 'failed', error: 'abandoned: heartbeat stale (engine crashed)' };
    recent[1] = { runId: 'r1', status: 'failed', error: 'abandoned: heartbeat stale (engine crashed)' };
    const v = evaluateRunaway({ recent, windowCounts: { failed: need } });
    expect(v.qualifies).toBe(true);
    expect(v.signature).toBe(DEAD);
  });

  it('refuses when reaper noise is the majority — that is a wedged engine', () => {
    const recent = failedRuns(need, 'abandoned: heartbeat stale (engine crashed)');
    recent[0] = { runId: 'r0', status: 'failed', error: DEAD };
    const v = evaluateRunaway({ recent, windowCounts: { failed: need } });
    expect(v.qualifies).toBe(false);
  });

  it('ignores runs older than the last N', () => {
    const recent = [...failedRuns(need, DEAD), { runId: 'old', status: 'completed', error: null }];
    const v = evaluateRunaway({ recent, windowCounts: { failed: need } });
    expect(v.qualifies).toBe(true);
  });
});

describe('dominant signature', () => {
  it('returns the most common string with its count', () => {
    expect(dominantSignature(['a', 'b', 'a', 'a'])).toEqual({ signature: 'a', count: 3 });
  });

  it('returns null for an empty set', () => {
    expect(dominantSignature([])).toBeNull();
  });
});

describe('cron expression', () => {
  it('reads the canonical key and tolerates the MCP tools’ legacy one', () => {
    expect(cronExprOf({ expression: '*/5 * * * *' })).toBe('*/5 * * * *');
    expect(cronExprOf({ cron: '*/15 * * * *' })).toBe('*/15 * * * *');
    expect(cronExprOf(null)).toBe('');
  });
});

describe('dead node types — naming a successor as evidence', () => {
  const REGISTRY: SuccessorCandidate[] = [
    {
      type: 'apple-calendar',
      label: 'Apple Calendar',
      description: 'Read and write events on iCloud calendars via CalDAV.',
      llmDescription: 'Use to fetch events for a date range or to create / update / delete events on an iCloud calendar.',
    },
    { type: 'api-call', label: 'API Call', description: 'Call a configured integration operation.' },
    { type: 'llm-call', label: 'LLM Call', description: 'Send a prompt to the LLM gateway.' },
    { type: 'gmail-send', label: 'Gmail Send', description: 'Send an email from a connected Gmail account.' },
  ];

  it('splits a hyphenated or camelCase type into fragments', () => {
    expect(deadTypeFragments('icloud-cal')).toEqual(['icloud', 'cal']);
    expect(deadTypeFragments('stealthScrapeLLM')).toEqual(['stealth', 'scrape', 'llm']);
    // Single characters are noise, not fragments.
    expect(deadTypeFragments('x-http-request')).toEqual(['http', 'request']);
  });

  it('names apple-calendar for the renamed icloud-cal', () => {
    const pick = pickSuccessor('icloud-cal', REGISTRY);
    expect(pick.candidate).toBe('apple-calendar');
    expect(pick.candidateConfidence).toBeGreaterThan(0.4);
  });

  it('beats the other *-call nodes, which only share the "cal" fragment', () => {
    const pick = pickSuccessor('icloud-cal', REGISTRY);
    expect(pick.candidate).not.toBe('api-call');
    expect(pick.candidate).not.toBe('llm-call');
  });

  it('names nothing for a type with no plausible successor', () => {
    expect(pickSuccessor('stats-summary', REGISTRY)).toEqual({
      candidate: null,
      candidateConfidence: 0,
    });
    expect(pickSuccessor('stats-trends', REGISTRY)).toEqual({
      candidate: null,
      candidateConfidence: 0,
    });
  });

  it('names nothing on a tie — a coin flip is not evidence', () => {
    const twins: SuccessorCandidate[] = [
      { type: 'foo-bar-one', label: 'One', description: 'x' },
      { type: 'foo-bar-two', label: 'Two', description: 'x' },
    ];
    expect(pickSuccessor('foo-bar', twins).candidate).toBeNull();
  });

  it('never names the dead type as its own successor', () => {
    const withGhost = [...REGISTRY, { type: 'icloud-cal', label: 'iCloud Cal', description: 'ghost' }];
    expect(pickSuccessor('icloud-cal', withGhost).candidate).toBe('apple-calendar');
  });

  it('names nothing when the registry is empty', () => {
    expect(pickSuccessor('icloud-cal', [])).toEqual({ candidate: null, candidateConfidence: 0 });
  });
});
