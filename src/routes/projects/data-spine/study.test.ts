import { describe, it, expect } from 'vitest';
import { study } from './study';
import { validateStudy, errors, notes } from '$lib/fieldstudy/validate';
import { arcBeats, beatBySlug, say, hasPlain, type Dual } from '$lib/fieldstudy/study';

/**
 * The Data Spine is the REFERENCE field study. If it stops obeying the system,
 * every study migrated toward it inherits the drift — so the checklist's
 * mechanical half runs here, against the real content, on every build.
 */
describe('data-spine · the reference study', () => {
  const findings = validateStudy(study);

  it('passes the ship gate', () => {
    // Printed in full on failure: "3 findings" is not a useful test failure,
    // the rule and the beat are.
    expect(errors(findings).map((f) => `${f.where}: ${f.rule} — ${f.message}`)).toEqual([]);
  });

  it('states three findings before beat 01', () => {
    expect(study.findings.length).toBeGreaterThanOrEqual(3);
    expect(study.beats[0].no).toBe('00');
    expect(study.beats[0].template).toBe('T0');
  });

  it('runs the fixed arc, in order, with no eighth beat', () => {
    expect(arcBeats(study).map((b) => b.no)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
  });

  it('gives every beat a question, a claim, a so-what and a falsifier', () => {
    for (const b of arcBeats(study)) {
      expect(b.question, `beat ${b.no} question`).toBeTruthy();
      expect(b.claim?.confidence, `beat ${b.no} confidence`).toMatch(/^(fact|hypothesis|contested)$/);
      expect(b.soWhat, `beat ${b.no} so-what`).toBeTruthy();
      expect(b.openQuestion?.falsifier, `beat ${b.no} falsifier`).toBeTruthy();
    }
  });

  it('is honest about its own reasoning', () => {
    // A study whose every claim is a fact is not reasoning, it is asserting.
    const levels = arcBeats(study).map((b) => b.claim?.confidence);
    expect(levels).toContain('hypothesis');
  });

  it('never lets a risk column come out shorter than its benefits', () => {
    for (const b of arcBeats(study)) {
      if (!b.ledger) continue;
      expect(b.ledger.risks.length, `beat ${b.no}`).toBeGreaterThanOrEqual(b.ledger.benefits.length);
    }
  });

  it('cites nothing that is not in sources[]', () => {
    // By MEMBERSHIP, not by range: `n` is a stable source id and the list is
    // deliberately non-contiguous (1, 2, 3, 11, 14, 21, 33), carried over from
    // the larger corpus this study was cut from. Renumbering on every trim
    // would rewrite every citation in the prose.
    const known = new Set(study.sources.map((s) => s.n));
    const cites = arcBeats(study).flatMap((b) => b.claim?.cites ?? []);
    for (const n of cites) expect(known.has(n), `citation [${n}]`).toBe(true);
  });

  it('has a route for every beat that claims one', () => {
    // The slugs are real directories under this route. A beat whose slug does
    // not resolve is a link the front matter offers and nothing serves.
    for (const slug of ['sources', 'architecture', 'model', 'outcomes', 'governance', 'next']) {
      expect(beatBySlug(study, slug), slug).toBeTruthy();
    }
  });

  it('gives every instrument its limits', () => {
    for (const i of study.instruments ?? []) {
      expect(i.limits, i.id).toBeTruthy();
    }
  });

  it('surfaces the places the fixed arc and the template rules disagree', () => {
    // Two of these are the arc's own tensions, and both are real: it puts two
    // WEIGHING beats side by side (05 who wins, 06 trust & safeguards), and
    // its closing beat (07 what happens next) is shaped like a position even
    // though T3 is "once per study".
    //
    // Pinned rather than tolerated. If either is resolved — by the rules
    // bending or by the content changing — this test says so on the next run
    // instead of the tension quietly persisting.
    expect(notes(findings).filter((f) => f.rule !== 'no-plain').map((f) => `${f.rule}: ${f.message}`)).toEqual([
      'position-twice: T3 appears more than once. A study makes one recommendation.',
      'rhythm: Beats 05 and 06 are both T4. Only T1 may repeat consecutively.',
    ]);
  });

  it('has a real ELI5 register on every beat', () => {
    // The shell ships a Research / ELI5 control on every page. Five of the
    // seven beats used to have nothing to say in plain English — the ledger
    // and position templates were never even handed the depth — so picking
    // ELI5 on them returned the page the reader already had.
    expect(notes(findings).filter((f) => f.rule === 'no-plain')).toEqual([]);
  });

  it('says something different at plain than at research, everywhere it matters', () => {
    // A plain register that repeats the research one is the same failure
    // wearing a costume, so identity is asserted against, not just presence.
    for (const b of arcBeats(study)) {
      const fields: [string, Dual | undefined][] = [
        ['claim', b.claim?.text],
        ['soWhat', b.soWhat],
        ['openQuestion', b.openQuestion?.text],
        ...(b.ledger ? ([['balance', b.ledger.balance]] as [string, Dual][]) : []),
        ...(b.position
          ? ([['statement', b.position.statement], ['sinkers', b.position.sinkers]] as [string, Dual][])
          : []),
      ];
      for (const [name, v] of fields) {
        if (v === undefined) continue;
        expect(hasPlain(v), `beat ${b.no} ${name} has no plain register`).toBe(true);
        expect(say(v, 'plain'), `beat ${b.no} ${name} says the same thing at both depths`).not.toBe(
          say(v, 'research'),
        );
      }
    }
  });
});
