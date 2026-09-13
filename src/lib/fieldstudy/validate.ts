/**
 * The ship gate, in code.
 *
 * `field-study-system/CHECKLIST.md` is the full list; this is the half a
 * machine can settle. Every rule here is one the schema cannot express — a
 * risk column at least as long as its benefit column is a relationship between
 * two arrays, not a shape.
 *
 * Findings are returned, never thrown. A study with a problem should still
 * render, with the problem visible in a test rather than a blank page.
 */
import { say, hasPlain, type Study, type Beat, type Dual } from './study';

export interface Finding {
  /** Where — a beat number, or 'study' for the whole thing. */
  where: string;
  rule: string;
  message: string;
}

const ARC = ['01', '02', '03', '04', '05', '06', '07'];

export function validateStudy(study: Study): Finding[] {
  const f: Finding[] = [];
  const add = (where: string, rule: string, message: string) => f.push({ where, rule, message });

  // ——— Argument ———
  if (study.findings.length < 3 || study.findings.length > 4) {
    add('study', 'findings-count', `A study states three findings, four at the most — this has ${study.findings.length}.`);
  }

  const arc = study.beats.filter((b) => b.no !== '00');
  const nos = arc.map((b) => b.no);
  const expected = ARC.slice(0, nos.length);
  if (nos.join(',') !== expected.join(',')) {
    add('study', 'arc-order', `Beats are the fixed arc in order. Expected ${expected.join(', ')}; got ${nos.join(', ')}.`);
  }
  if (!study.beats.some((b) => b.no === '00' && b.template === 'T0')) {
    add('study', 'no-front-matter', 'The front matter (beat 00, T0) is missing — the findings have nowhere to be stated.');
  }
  if (study.beats.filter((b) => b.template === 'T0').length > 1) {
    add('study', 'front-matter-twice', 'T0 appears more than once. It is the landing page, and there is one.');
  }
  if (study.beats.filter((b) => b.template === 'T3').length > 1) {
    add('study', 'position-twice', 'T3 appears more than once. A study makes one recommendation.');
  }
  // ^ and `rhythm` below are NOTES, not failures — see NOTE_RULES.

  // ——— Honesty ———
  const claims = [
    ...study.findings,
    ...arc.flatMap((b) => [
      ...(b.claim ? [b.claim] : []),
      ...(b.ledger?.benefits ?? []),
      ...(b.ledger?.risks ?? []),
      ...(b.sections ?? []).flatMap((s) => (s.claim ? [s.claim] : [])),
    ]),
  ];
  if (!claims.some((c) => c.confidence === 'hypothesis')) {
    add('study', 'no-hypothesis', 'No claim anywhere is a hypothesis. A study with none is not being honest about its own reasoning.');
  }
  for (const c of claims) {
    if (!['fact', 'hypothesis', 'contested'].includes(c.confidence)) {
      add('study', 'confidence-invented', `"${c.confidence}" is not one of fact | hypothesis | contested.`);
    }
  }

  // `n` is a stable source ID, not an array index. The study's list is
  // deliberately non-contiguous — 1, 2, 3, 11, 14, 21, 33 — because the
  // numbers survive from the larger corpus the study was cut from, and
  // renumbering them on every trim would silently rewrite every citation in
  // the prose. So a citation resolves by membership, never by range.
  const known = new Set(study.sources.map((s) => s.n));
  const citesOf = (n: number[] | undefined) => n ?? [];
  const everyCite = [
    ...claims.flatMap((c) => citesOf(c.cites)),
    ...arc.flatMap((b) => (b.figures ?? []).flatMap((g) => citesOf(g.cites))),
  ];
  for (const n of new Set(everyCite)) {
    if (!known.has(n)) {
      add('study', 'dangling-cite', `Citation [${n}] has no source. sources[] carries ${[...known].join(', ')}.`);
    }
  }
  // The reverse is worth knowing too: a source nobody cites is either a
  // citation that got dropped in an edit, or reading the author did not use.
  for (const s of study.sources) {
    if (!everyCite.includes(s.n)) {
      add('study', 'uncited-source', `Source [${s.n}] (${s.org}) is never cited.`);
    }
  }

  // ——— Per beat ———
  for (const b of arc) {
    const at = `beat ${b.no}`;
    if (!b.question) add(at, 'no-question', `${b.name} asks no question. One per beat, printed at the top.`);
    if (!b.claim) add(at, 'no-claim', `${b.name} states no claim answering its question.`);
    if (!b.soWhat) add(at, 'no-sowhat', `${b.name} ends without a "so what" in the author's voice.`);
    if (!b.openQuestion) {
      add(at, 'no-open-question', `${b.name} ends without an open question.`);
    } else if (!b.openQuestion.falsifier?.trim()) {
      add(at, 'no-falsifier', `${b.name}'s open question names nothing that would change the author's mind.`);
    }

    if (b.template === 'T4' && b.ledger) {
      if (b.ledger.risks.length < b.ledger.benefits.length) {
        add(at, 'risk-column-short', `${b.ledger.risks.length} risks against ${b.ledger.benefits.length} benefits. If the risk column is shorter, the study has not looked hard enough.`);
      }
    }

    if (b.template === 'T2' && b.survey) {
      const s = b.survey;
      if (!s.asOf) add(at, 'undated-count', 'The survey has no asOf date. Every number carries the date it was true.');
      if (!s.provenance) add(at, 'no-provenance', 'The survey has no provenance strip. Provenance is on the page, never only in the footer.');
      const widths = new Set(s.rows.map((r) => r.cells.length));
      if (widths.size > 1) {
        add(at, 'ragged-survey', `Survey rows have ${[...widths].join(' / ')} cells. Every row has identical fields.`);
      }
      if (s.columns.length && widths.size === 1 && ![...widths][0] !== undefined) {
        const w = [...widths][0];
        if (w !== s.columns.length) {
          add(at, 'survey-columns', `${w} cells against ${s.columns.length} columns.`);
        }
      }
    }

    if (b.template === 'T3' && b.position) {
      if (b.position.because.length !== 3) {
        add(at, 'because-count', `The because band is three cells; this has ${b.position.because.length}.`);
      }
      if (!b.position.rejected.length) {
        add(at, 'no-alternatives', 'A position with no named alternatives is not defended, it is asserted.');
      }
      if (!say(b.position.sinkers).length) {
        add(at, 'no-sinkers', 'A position must say what would sink it.');
      }
      // Both registers have to fit the slot — an ELI5 rewrite that overflows
      // is the same bug as a research one that does.
      for (const d of ['research', 'plain'] as const) {
        const line = say(b.position.statement, d);
        if (line.length > 90) {
          add(at, 'statement-long', `The call itself is ${line.length} characters at ${d}; the slot is 90.`);
        }
      }
    }

    if (b.template === 'T6' || b.template === 'T7' || b.template === 'T8') {
      add(at, 'section-scale-as-beat', `${b.template} is section-scale — it sits inside a T1 or T2 beat rather than owning one.`);
    }

    for (const s of b.sections ?? []) {
      if (s.template === 'T6') {
        for (const l of s.layers ?? []) {
          if (!l.theFight?.trim()) add(at, 'layer-no-fight', `Layer ${l.no} (${l.name}) names no fight.`);
        }
        if ((s.layers?.length ?? 0) > 6) add(at, 'too-many-layers', 'An anatomy is six layers at most.');
      }
      if (s.template === 'T8') {
        for (const c of s.cases ?? []) {
          if (!c.fate?.trim()) add(at, 'case-no-fate', `Case "${c.name}" has no fate.`);
          if (!c.lesson?.trim()) add(at, 'case-no-lesson', `Case "${c.name}" has no lesson.`);
        }
      }
      if (s.template === 'T7' && (s.threads?.length ?? 0) < 2) {
        add(at, 'one-thread', 'A chronicle runs two named threads. One undifferentiated thread is a Wikipedia table.');
      }
    }
  }

  // ——— Depth ———
  // The shell ships a Research / ELI5 control on every page. A beat with no
  // plain register anywhere hands a reader who asked for plain English exactly
  // the page they already had. Reported rather than enforced: the rule arrived
  // after both studies shipped, and failing a build over prose that has simply
  // not been written yet is the wrong lever.
  for (const b of arc) {
    const carriers = [
      b.standfirst, b.soWhat, b.claim?.text, b.openQuestion?.text,
      ...(b.prose ?? []).map((p) => (p.plain ? { research: p.research, plain: p.plain } : p.research)),
      ...(b.figures ?? []).map((f) => f.caption),
      ...(b.ledger ? [b.ledger.balance, ...b.ledger.benefits.map((c) => c.text), ...b.ledger.risks.map((c) => c.text)] : []),
      ...(b.position ? [b.position.statement, b.position.elaboration, b.position.sinkers] : []),
    ];
    if (!carriers.some(hasPlain)) {
      add(`beat ${b.no}`, 'no-plain', `${b.name} has no plain-English register anywhere, so the ELI5 control does nothing on it.`);
    }
  }

  // ——— The plain register echoing the research one ———
  // A `plain` that merely reshuffles a few words of the research text is the
  // ELI5 failure wearing a costume: the control moves, the reader learns
  // nothing, and the study can claim a depth control it does not really have.
  // Measured as shared-vocabulary overlap, ignoring markup, so a genuinely
  // shorter rewrite passes and a light reword does not.
  //
  // The threshold is deliberately loose. Short factual lines legitimately
  // repeat their nouns and numbers — "three suppliers cover four schools in
  // five" cannot be said without them — and both shipped studies sit at or
  // under 78%. Anything at 80% or above is a reword, not a translation.
  const overlap = (a: string, b: string) => {
    const words = (t: string) =>
      new Set(t.toLowerCase().replace(/<[^>]*>/g, ' ').split(/\W+/).filter(Boolean));
    const wa = words(a);
    const wb = words(b);
    if (!wa.size || !wb.size) return 0;
    const shared = [...wa].filter((w) => wb.has(w)).length;
    return shared / Math.max(wa.size, wb.size);
  };
  for (const b of arc) {
    const fields: [string, Dual | undefined][] = [
      ['claim', b.claim?.text], ['standfirst', b.standfirst], ['so-what', b.soWhat],
      ['open question', b.openQuestion?.text],
      ...(b.marginNotes ?? []).map((m, i) => [`margin note ${i + 1}`, m.text] as [string, Dual]),
      ...(b.figures ?? []).map((f) => [`figure ${f.no}`, f.caption] as [string, Dual]),
      ...(b.ledger
        ? [['balance', b.ledger.balance] as [string, Dual],
           ...b.ledger.benefits.map((c, i) => [`benefit ${i + 1}`, c.text] as [string, Dual]),
           ...b.ledger.risks.map((c, i) => [`risk ${i + 1}`, c.text] as [string, Dual])]
        : []),
      ...(b.position
        ? [['statement', b.position.statement] as [string, Dual],
           ['elaboration', b.position.elaboration] as [string, Dual],
           ['sinkers', b.position.sinkers] as [string, Dual]]
        : []),
    ];
    for (const [name, v] of fields) {
      if (!hasPlain(v)) continue;
      const sim = overlap(say(v, 'research'), say(v, 'plain'));
      if (sim >= 0.8) {
        add(`beat ${b.no}`, 'plain-echo',
          `The plain register of ${name} shares ${Math.round(sim * 100)}% of its words with the research one. That is a reword, not a translation.`);
      }
    }
  }

  // ——— Rhythm ———
  // Reported separately from the errors above because the FIXED ARC puts two
  // weighing beats next to each other by design: 05 "who wins" and 06 "trust &
  // safeguards" are both ledgers in the system's own reference study. The rule
  // and the arc are in genuine tension there, so this is a note, not a failure.
  for (let i = 1; i < arc.length; i++) {
    const a = arc[i - 1];
    const b = arc[i];
    if (a.template === b.template && a.template !== 'T1') {
      add(`beat ${b.no}`, 'rhythm', `Beats ${a.no} and ${b.no} are both ${a.template}. Only T1 may repeat consecutively.`);
    }
  }

  // ——— Instruments ———
  for (const i of study.instruments ?? []) {
    if (!i.limits?.trim()) {
      add(`instrument ${i.id}`, 'no-limits', `${i.name} does not state what it does not show.`);
    }
  }

  return f;
}

/**
 * Two rules the FIXED ARC puts in tension with the template rules, both of
 * which the system's own reference study exhibits:
 *
 * - `rhythm` — only T1 may repeat consecutively, but beats 05 ("who wins") and
 *   06 ("trust & safeguards") are both weighing, so both are ledgers.
 * - `position-twice` — T3 is "once per study", but beat 07 ("what happens
 *   next") is shaped like a position too: a call, defended, with the
 *   alternative named. It is not a competing recommendation, it is the close.
 *
 * They are reported rather than suppressed, and reported rather than enforced,
 * because the honest answer is that the arc and the rules disagree here and
 * that is a decision for the system's author, not for a validator.
 */
export const NOTE_RULES = ['rhythm', 'position-twice', 'no-plain'] as const;

/** Findings that should fail a build — everything except the arc's own tensions. */
export function errors(findings: Finding[]): Finding[] {
  return findings.filter((f) => !(NOTE_RULES as readonly string[]).includes(f.rule));
}

/** The arc-vs-rules tensions, surfaced deliberately. */
export function notes(findings: Finding[]): Finding[] {
  return findings.filter((f) => (NOTE_RULES as readonly string[]).includes(f.rule));
}
