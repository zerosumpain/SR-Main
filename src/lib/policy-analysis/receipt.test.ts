// The purge receipt: what it says, and what it refuses to leave out.
import { describe, expect, it } from 'vitest';
import { buildReceipt, receiptText, unreachable, type Probe } from './receipt';

const clean: Probe[] = [
  { table: 'policy_analyses', what: 'the assessment row itself', rows: 0 },
  { table: 'workflow_runs', what: 'queue envelopes naming it', rows: 0 },
];

describe('the verdict', () => {
  it('is clean only when every probe is zero', () => {
    expect(buildReceipt({ analysisId: 'a', sealed: true, keyDestroyed: true, probes: clean }).clean).toBe(true);
    expect(buildReceipt({ analysisId: 'a', sealed: true, keyDestroyed: true, probes: [...clean, { table: 'policy_artefacts', what: 'x', rows: 3 }] }).clean).toBe(false);
  });
});

describe('what it admits it cannot reach', () => {
  it('always names the model provider, sealed or not', () => {
    for (const sealed of [true, false]) {
      expect(unreachable(sealed).join(' ')).toContain('model provider');
    }
  });

  it('tells an UNSEALED purge that readable copies may remain in backups', () => {
    const said = unreachable(false).join(' ');
    expect(said).toContain('backups');
    expect(said).toContain('write-ahead log');
    expect(said).toContain('Seal a run at submission');
  });

  it('tells a SEALED purge the copies are unreadable, and says where the key was', () => {
    const said = unreachable(true, '/var/lib/example/policy-keys').join(' ');
    expect(said).toContain('unreadable');
    expect(said).toContain('/var/lib/example/policy-keys');
    // The claim that carries the guarantee: it was never in a backup in the first
    // place, so nothing had to find it.
    expect(said).toContain('never in a backup');
  });
});

describe('the file', () => {
  const receipt = buildReceipt({ analysisId: 'c2538648-0000-4000-8000-000000000000', sealed: true, keyDestroyed: true, probes: clean, at: new Date('2026-09-11T15:00:00Z') });

  it('leads with the verdict and carries every probe', () => {
    const text = receiptText(receipt);
    expect(text).toContain('CLEAN');
    expect(text).toContain('c2538648-0000-4000-8000-000000000000');
    expect(text).toContain('policy_analyses');
    expect(text).toContain('queue envelopes naming it');
    expect(text).toContain('2026-09-11T15:00:00.000Z');
  });

  it('never carries the assessment’s title', () => {
    // The receipt outlives the run. A file called "purge receipt" carrying the
    // name of an unpublished paper would re-create the disclosure it certifies
    // the end of — so there is nowhere to put one, and this pins that.
    expect(Object.keys(receipt)).not.toContain('title');
    expect(receiptText(receipt)).not.toMatch(/title/i);
  });

  it('says it is not stored, because the reader has no other way to know', () => {
    expect(receiptText(receipt)).toContain('not stored anywhere');
  });
});
