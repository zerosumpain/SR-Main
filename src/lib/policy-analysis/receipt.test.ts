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
  it('always names OpenAI, sealed or not, and no longer overclaims about it', () => {
    for (const sealed of [true, false]) {
      const said = unreachable(sealed).join(' ');
      expect(said).toContain('OpenAI');
      // Checked rather than assumed: kept up to 30 days for abuse monitoring,
      // deletable from that account sooner, not deletable from here.
      expect(said).toContain('30 days');
      expect(said).toMatch(/not from here/i);
    }
  });

  it('no longer says a backup copy may remain, because none is made', () => {
    // The nightly dump stopped including the policy tables on 2026-09-11. Both
    // versions of this list used to talk about backups — one warning of readable
    // copies, one explaining why its copies were unreadable — and a receipt that
    // kept saying either would be certifying an absence against a hazard that no
    // longer exists.
    for (const sealed of [true, false]) {
      expect(unreachable(sealed).join(' ')).not.toMatch(/backup/i);
    }
  });

  it('still tells an UNSEALED purge what is left on the live machine', () => {
    const said = unreachable(false).join(' ');
    expect(said).toMatch(/scratch space/i);
    expect(said).toContain('Seal a run at submission');
  });

  it('tells a SEALED purge where the key was, so the claim can be checked', () => {
    expect(unreachable(true, '/var/lib/example/policy-keys').join(' ')).toContain('/var/lib/example/policy-keys');
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
