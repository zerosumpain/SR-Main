import { describe, expect, it } from 'vitest';
import {
  EXTRACTED_TRIGGERS,
  claimableTriggerSql,
  externalTriggers,
  isExternallyOwned,
} from '../../../src/lib/workflows/trigger-ownership';

describe('queue trigger ownership', () => {
  it('defaults to the triggers whose applications have actually been extracted', () => {
    expect(externalTriggers({})).toEqual(['policy-analysis']);
    expect(isExternallyOwned('policy-analysis', {})).toBe(true);
    expect(isExternallyOwned('daydream', {})).toBe(false);
  });

  it('treats a run with no trigger as this process’s own work', () => {
    // workflow_runs.trigger is NOT NULL today, so this is defensive rather than a
    // bug being fixed — but the predicate and this function have to agree about
    // it, and the SQL spells the NULL case out.
    expect(isExternallyOwned(null, {})).toBe(false);
    expect(isExternallyOwned(undefined, {})).toBe(false);
    expect(isExternallyOwned('', {})).toBe(false);
  });

  it('lets an extraction add a lane without editing a SQL string', () => {
    const env = { EXTERNAL_QUEUE_TRIGGERS: 'policy-analysis,health-sync' };
    expect(externalTriggers(env)).toEqual(['policy-analysis', 'health-sync']);
    expect(isExternallyOwned('health-sync', env)).toBe(true);
  });

  it('returns every lane to Main when the override is empty, which is the rollback', () => {
    expect(externalTriggers({ EXTERNAL_QUEUE_TRIGGERS: '' })).toEqual([]);
    expect(isExternallyOwned('policy-analysis', { EXTERNAL_QUEUE_TRIGGERS: '' })).toBe(false);
  });

  it('refuses a malformed trigger name rather than silently handing a lane back', () => {
    // A typo means Main resumes claiming runs a dedicated worker is still leasing:
    // two owners, no error anywhere.
    expect(() => externalTriggers({ EXTERNAL_QUEUE_TRIGGERS: 'policy analysis' })).toThrow(/invalid trigger name/);
    expect(() => externalTriggers({ EXTERNAL_QUEUE_TRIGGERS: 'Policy-Analysis' })).toThrow();
    expect(() => externalTriggers({ EXTERNAL_QUEUE_TRIGGERS: '*' })).toThrow();
  });

  it('tolerates spacing around names', () => {
    expect(externalTriggers({ EXTERNAL_QUEUE_TRIGGERS: ' policy-analysis , health-sync ' })).toEqual([
      'policy-analysis',
      'health-sync',
    ]);
  });

  it('builds a null-safe predicate, and a permissive one when nothing is external', () => {
    const excluding = claimableTriggerSql({ EXTERNAL_QUEUE_TRIGGERS: 'policy-analysis' });
    const chunks = JSON.stringify(excluding);
    expect(chunks).toContain('trigger IS NULL');
    expect(chunks).toContain('policy-analysis');

    const permissive = JSON.stringify(claimableTriggerSql({ EXTERNAL_QUEUE_TRIGGERS: '' }));
    expect(permissive).toContain('true');
    expect(permissive).not.toContain('policy-analysis');
  });

  it('keeps the shipped default in step with the exported constant', () => {
    expect(externalTriggers({})).toEqual([...EXTRACTED_TRIGGERS]);
  });
});

describe('the bash copy of the lane list', () => {
  // The deploy drain is bash and cannot import this module, so the list is
  // duplicated into a generated file. A duplicate nobody checks is how the
  // third extraction pauses the second one's in-flight runs.
  const listPath = 'scripts/external-queue-triggers.txt';

  it('matches the TypeScript source of truth exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const listed = readFileSync(listPath, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean);
    expect(listed).toEqual([...EXTRACTED_TRIGGERS]);
  });

  it('is read into the same predicate the TypeScript builds', async () => {
    const { execFileSync } = await import('node:child_process');
    const clause = execFileSync(
      'bash',
      ['-c', `set -euo pipefail; source scripts/lib/queue-triggers.sh; queue_triggers_clause ${listPath}; printf '%s' "$QUEUE_MINE_SQL"`],
      { encoding: 'utf8' },
    );
    // One spelling of the rule across TypeScript and both bash drains. The three
    // used to be `IS DISTINCT FROM`, `<>` and `<>`, which is how they drift.
    expect(clause).toBe("AND (trigger IS NULL OR trigger NOT IN ('policy-analysis'))");
    expect(clause).not.toContain('<>');
  });

  it('honours EXTERNAL_QUEUE_TRIGGERS too, so the override moves both halves', async () => {
    // If the env var moved only the TypeScript queue, the documented rollback
    // (EXTERNAL_QUEUE_TRIGGERS='') would return a lane to Main's worker while
    // this drain still refused to pause it — Main's own in-flight runs would
    // survive the restart stuck in 'running'. The mirror case is worse: handing a
    // lane out by env var while the drain still pauses its rows is Main writing
    // to a row another process owns.
    const { execFileSync } = await import('node:child_process');
    const clause = (value: string) =>
      execFileSync(
        'bash',
        ['-c', `set -euo pipefail; source scripts/lib/queue-triggers.sh; queue_triggers_clause ${listPath}; printf '%s' "$QUEUE_MINE_SQL"`],
        { encoding: 'utf8', env: { ...process.env, EXTERNAL_QUEUE_TRIGGERS: value } },
      );

    expect(clause('')).toBe('');
    expect(clause('policy-analysis,health-sync')).toBe(
      "AND (trigger IS NULL OR trigger NOT IN ('policy-analysis', 'health-sync'))",
    );
    // And it rejects the same names the TypeScript rejects — under the drains'
    // own `set -e`, where a bad name aborts the deploy rather than being ignored.
    expect(() => clause('policy analysis')).toThrow();
  });

  it('pauses everything when no lane is externally owned', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const empty = join(mkdtempSync(join(tmpdir(), 'triggers-')), 'list.txt');
    writeFileSync(empty, '# nothing extracted yet\n\n');
    const clause = execFileSync(
      'bash',
      ['-c', `set -euo pipefail; source scripts/lib/queue-triggers.sh; queue_triggers_clause ${empty}; printf '%s' "$QUEUE_MINE_SQL"`],
      { encoding: 'utf8' },
    );
    expect(clause).toBe('');
  });
});
