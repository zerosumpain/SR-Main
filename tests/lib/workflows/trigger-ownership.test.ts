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
