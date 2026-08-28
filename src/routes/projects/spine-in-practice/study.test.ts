import { describe, it, expect } from 'vitest';
import { study } from './study';
import { validateStudy, errors, notes } from '$lib/fieldstudy/validate';
import { arcBeats, beatBySlug } from '$lib/fieldstudy/study';

/**
 * The Spine in Practice runs the same mechanical ship gate as the reference
 * study. It is the first study authored AFTER the system shipped rather than
 * migrated into it, so if the checklist is going to be ambiguous anywhere, it
 * is going to be here — which is exactly why the gate runs on every build.
 */
describe('spine-in-practice · the appraisal', () => {
  const findings = validateStudy(study);

  it('passes the ship gate', () => {
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
    const known = new Set(study.sources.map((s) => s.n));
    const cites = arcBeats(study).flatMap((b) => b.claim?.cites ?? []);
    for (const n of cites) expect(known.has(n), `citation [${n}]`).toBe(true);
  });

  it('has a route for every beat that claims one', () => {
    // The slugs are real directories under this route. A beat whose slug does
    // not resolve is a link the front matter offers and nothing serves.
    for (const slug of ['built', 'structure', 'representation', 'benefits', 'limits', 'next']) {
      expect(beatBySlug(study, slug), slug).toBeTruthy();
    }
  });

  it('gives every instrument its limits', () => {
    for (const i of study.instruments ?? []) {
      expect(i.limits, i.id).toBeTruthy();
    }
  });

  it('never lets a claim about the node access layer overstate what is built', () => {
    // The subject of this study was scrupulous about its own boundary — the
    // deck says in terms that "nothing designed is described as built". An
    // appraisal that blurs the line while criticising the thing for its
    // boundary would be worse than useless, so the words that name unbuilt
    // components may only ever appear on a claim that is NOT a fact about
    // present capability. Anything asserting one of these as live is a bug in
    // the content, and this catches it before the page ships.
    const UNBUILT = /\b(differential privacy|research runner|dominance check)\b/i;
    const factClaims = [
      ...study.findings,
      ...arcBeats(study).flatMap((b) => [
        ...(b.claim ? [b.claim] : []),
        ...(b.ledger?.benefits ?? []),
        ...(b.ledger?.risks ?? []),
      ]),
    ].filter((c) => c.confidence === 'fact');

    for (const c of factClaims) {
      if (!UNBUILT.test(c.text)) continue;
      expect(
        /\b(not|never|no|designed|unbuilt|next build|remain|absent|without)\b/i.test(c.text),
        `a "fact" claim naming an unbuilt component must say it is unbuilt: "${c.text}"`,
      ).toBe(true);
    }
  });

  it('surfaces the places the fixed arc and the template rules disagree', () => {
    // Pinned rather than tolerated, exactly as the reference study does it: if
    // the tension is ever resolved — by the rules bending or by the content
    // changing — this says so on the next run rather than quietly persisting.
    expect(notes(findings).map((f) => f.rule).sort()).toEqual(['rhythm']);
  });
});
