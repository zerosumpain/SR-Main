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
    // `trigger <> 'policy-analysis'` evaluated to NULL for these rows, so they fell
    // out of every reap. They belong to Main and must stay claimable.
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

  it('is read into a null-safe predicate, not a bare inequality', async () => {
    const { execFileSync } = await import('node:child_process');
    const clause = execFileSync(
      'bash',
      ['-c', `source scripts/lib/queue-triggers.sh; queue_triggers_clause ${listPath}; printf '%s' "$QUEUE_MINE_SQL"`],
      { encoding: 'utf8' },
    );
    // `trigger <> 'x'` is NULL — not true — for a run with no trigger, so the
    // old drain silently left every untriggered run running.
    expect(clause).toBe("AND (trigger IS NULL OR trigger NOT IN ('policy-analysis'))");
    expect(clause).not.toContain('<>');
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
      ['-c', `source scripts/lib/queue-triggers.sh; queue_triggers_clause ${empty}; printf '%s' "$QUEUE_MINE_SQL"`],
      { encoding: 'utf8' },
    );
    expect(clause).toBe('');
  });
});
