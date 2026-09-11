/**
 * The assessment as a document, for Word and for anything else that wants prose.
 *
 * The dashboard is a dashboard: figures, hover cards, a drill. None of that
 * survives being emailed to somebody who needs to read it on a train, and a
 * printed PDF is not a thing a colleague can mark up and send back. So the same
 * artefacts render a second time, as a linear document, and this module is that
 * rendering.
 *
 * PURE, and markdown, for three reasons that all turned out to be the same one.
 * It can be asserted in a test without a database or a headless browser; the
 * SHARED copy can render the identical document simply by handing it the
 * redacted artefact list, so the two can never drift; and the repo already turns
 * markdown into .docx through `synthesize()`, which is how
 * `/projects/dfe-data-strategy` produces its Word brief. Writing an OOXML
 * builder here would be a second one of those.
 *
 * The ORDER is the report's own five acts, not the dashboard's tab strip. A
 * document is read front to back and a dashboard is not, so the exploitation
 * playbook comes after the verdict it explains rather than in a tab beside it.
 */
import type { Artefact } from './contracts';
import { KEY_SECTIONS, READING_CHAIN } from './glossary';
import { REPORT_ACTS, actorBoard, evidenceMix, fragileAssumptions, findingsBySection, headline, of, plays, BAND_LABEL, type Band } from './view';
import { checks } from './view';
import { isBody, network } from './network';
import { adjacency } from './matrix';

export type DocMeta = {
  title: string;
  jurisdiction?: string | null;
  policyArea?: string | null;
  depth?: string | null;
  status?: string | null;
  completedAt?: string | Date | null;
  /** Named on the cover so a shared copy never claims to be the whole thing. */
  withheld?: string[];
  /** Gaps the assessment reported about itself. Printed, never quietly dropped. */
  warnings?: { stage: string; text: string }[];
};

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const date = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

/** Markdown is whitespace-sensitive in exactly one way that matters: blank lines. */
function block(lines: (string | null | undefined | false)[]): string {
  return lines.filter((l): l is string => Boolean(l)).join('\n\n');
}

/**
 * The standing frame, printed on every copy.
 *
 * The reader of an exported document is by definition NOT at the dashboard,
 * where the strap above each section says what it is. Somebody forwarded this to
 * them. So the one thing they must not have to infer — that this is an
 * adversarial read and not an assurance review — is stated on page one.
 */
const FRAME = [
  'This is a **red-team assessment**. It reads the paper the way a body governed by it would:',
  'looking for what can be done, within the rules as written, by an actor serving itself.',
  'It is not an assurance review, it does not assume anyone intends any of this, and it will',
  'not tell you the policy is fine. Where it says a body *would* do something, that is a',
  'hypothesis about incentives — arguable, and marked as such throughout.',
].join(' ');

function cover(meta: DocMeta, artefacts: Artefact[]): string {
  const list = plays(artefacts);
  const severe = list.filter((p) => p.band === 'severe' || p.band === 'significant').length;
  const failing = of(artefacts, 'test').filter((t) => ['high_risk', 'moderate_risk'].includes(String(t.data.result)));
  // Depth is OMITTED when it is not known rather than defaulted. A shared copy
  // is not handed `depth` — `resolveShare` does not carry it — and a ternary
  // printed "Standard enquiry" on a deep assessment, which is a false statement
  // about the run in the one document a reader cannot check against the page.
  const depth = meta.depth === 'deep' ? 'Deep enquiry' : meta.depth === 'standard' ? 'Standard enquiry' : null;
  const context = [meta.jurisdiction, meta.policyArea, depth].filter(Boolean).join(' · ');
  const done = date(meta.completedAt);

  return block([
    `# ${meta.title}`,
    context || null,
    FRAME,
    '## At a glance',
    [
      `- **${list.length}** way${list.length === 1 ? '' : 's'} the policy can be beaten${severe ? `, of which **${severe}** rank above moderate` : ''}`,
      `- **${of(artefacts, 'profile').length}** actors profiled for what actually moves them`,
      `- **${failing.length}** of ${of(artefacts, 'test').length} structural checks fell short`,
      `- **${of(artefacts, 'evidence').filter((e) => ['insufficient', 'contradicts'].includes(String(e.data.result))).length}** of ${of(artefacts, 'evidence').length} evidence links are unsupported or disputed`,
      done ? `- Assessment completed ${done}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    meta.withheld?.length
      ? `> **This is a shared copy.** It withholds ${meta.withheld.join(', ')}. References to withheld material have been removed rather than left dangling.`
      : null,
  ]);
}

/** The verdict, in full — the one section a document must not summarise. */
function verdict(artefacts: Artefact[]): string {
  const lead = headline(artefacts);
  if (!lead) return block(['## The verdict', 'The assessment did not reach a conclusion. What follows is what it established before it stopped.']);
  return block(['## The verdict', lead.statement]);
}

function playbook(artefacts: Artefact[]): string {
  const list = plays(artefacts);
  if (!list.length) return '';
  const rows = list.map((play, index) => {
    const d = play.artefact.data as Record<string, unknown>;
    const legality =
      d.legality === 'compliant'
        ? 'Stays within the rules as written'
        : d.legality === 'grey'
          ? 'Arguable either way'
          : 'Would be a breach';
    return block([
      `### ${index + 1}. ${play.artefact.label}`,
      `**${BAND_LABEL[play.band as Band] ?? play.band} · exposure ${Math.round(play.exposure * 100)}** — ${play.actor?.label ?? 'actor unresolved'}. ${legality}.`,
      play.artefact.statement,
      `Incentive ${Math.round(Number(d.incentive) * 100)} · ease ${Math.round(Number(d.ease) * 100)} · impact ${Math.round(Number(d.impact) * 100)} · concealment ${Math.round(Number(d.concealment) * 100)}. Exposure is the even blend of the four, and is a severity rather than a certainty.`,
      clean(d.payoff) && `**What they get.** ${clean(d.payoff)}`,
      clean(d.costToPolicy) && `**What it costs the policy.** ${clean(d.costToPolicy)}`,
      clean(d.earlyWarning) && `**First sign of it.** ${clean(d.earlyWarning)}`,
      clean(d.counter) && `**What would close it.** ${clean(d.counter)}`,
    ]);
  });
  return block([
    '## The exploitation playbook',
    'Each play is something a body named in the policy could do to serve itself at the policy’s expense, ranked by the even blend of how much the actor gains, how easily it can be done, how much of the objective it destroys, and how poorly the policy would notice.',
    ...rows,
  ]);
}

function cast(artefacts: Artefact[]): string {
  const board = actorBoard(artefacts, plays(artefacts));
  if (!board.length) return '';
  const PERSONA: [string, string][] = [
    ['accountableTo', 'Answers to'],
    ['successCriteria', 'Judged on'],
    ['timeHorizon', 'Can look ahead'],
    ['outsideOption', 'Does instead'],
    ['gainFromFailure', 'Better off if it fails'],
  ];
  const rows = board.map((view) => {
    const fields = PERSONA.map(([key, label]) => {
      const raw = view.profile?.data?.[key] as { value?: string } | undefined;
      return raw?.value ? `- **${label}.** ${clean(raw.value)}` : null;
    }).filter(Boolean);
    return block([
      `### ${view.actor.label}`,
      clean(view.actor.data.entityType).replaceAll('_', ' ') || null,
      fields.length ? fields.join('\n') : 'No incentive profile was built for this body.',
      view.plays.length
        ? `Plays available to it: ${view.plays.map((p) => `${p.artefact.label} (${BAND_LABEL[p.band as Band] ?? p.band})`).join('; ')}.`
        : 'No exploitation play was found for this body. That is a finding, not a guarantee.',
    ]);
  });
  return block(['## Who is in the room', 'What each body says it wants, what its position rewards, who it answers to, and who is better off if this policy fails.', ...rows]);
}

function structure(artefacts: Artefact[]): string {
  const rows = checks(artefacts);
  if (!rows.length) return '';
  const words: Record<string, string> = {
    high_risk: 'High risk',
    moderate_risk: 'Moderate risk',
    low_risk: 'Covered',
    indeterminate: 'No evidence either way',
  };
  return block([
    '## Structural checks',
    'These are the only figures in this document no model produced. Each walks the relationships the policy states and asks whether the counterpart it depends on is there. **A check with nothing to look at is not a pass.**',
    ...rows.map((check) =>
      block([
        `### ${check.label} — ${words[String(check.data.result)] ?? 'unknown'}`,
        check.statement,
        clean(check.data.mitigation) && `*${clean(check.data.mitigation)}*`,
      ]),
    ),
  ]);
}

function relationships(artefacts: Artefact[]): string {
  const net = network(artefacts);
  if (!net.edges.length) return '';
  const bodies = net.nodes.filter(isBody).length;
  // How many relationships run between two BODIES is the fact the page leads
  // with and the one a printed pack could not previously be read for: a paper
  // where almost none do has described who benefits and what will be done
  // without describing who answers to whom.
  const placeable = adjacency(net).placeable;
  return block([
    '## The policy as a network',
    `${bodies} bodies and ${net.nodes.length - bodies} pieces of machinery, ${net.edges.length} stated relationships between them — of which ${placeable} run between two bodies.`,
    ...net.insights.map((insight) =>
      block([
        `### ${insight.headline}`,
        insight.reading,
        insight.subjects.map((s) => `- **${s.label}** — ${s.note}`).join('\n'),
      ]),
    ),
  ]);
}

function foundations(artefacts: Artefact[]): string {
  const fragile = fragileAssumptions(artefacts).slice(0, 10);
  const mix = evidenceMix(artefacts).filter((m) => m.count);
  if (!fragile.length && !mix.length) return '';
  return block([
    '## What it rests on',
    fragile.length
      ? block([
          '### The assumptions most likely to change the conclusion',
          fragile
            .map(
              (a) =>
                `- **${a.label}** — importance ${Math.round(Number(a.data.importance) * 100)}%, uncertainty ${Math.round(Number(a.data.uncertainty) * 100)}%, consequence ${Math.round(Number(a.data.consequence) * 100)}%. ${clean(a.statement)}`,
            )
            .join('\n'),
        ])
      : null,
    mix.length
      ? block([
          '### The evidence behind the claims',
          mix.map((m) => `- **${m.count}** ${m.label.toLowerCase()}`).join('\n'),
          'An "insufficient" result is the honest answer for most claims in most policy papers. It is not a criticism of the claim; it means the assessment cannot help you defend it if it is challenged.',
        ])
      : null,
  ]);
}

function scenarios(artefacts: Artefact[]): string {
  const rows = of(artefacts, 'scenario');
  if (!rows.length) return '';
  return block([
    '## Conditions the policy has to survive',
    ...rows.map((s) =>
      block([
        `### ${clean(s.data.scenario).replaceAll('_', ' ')} — ${s.label}`,
        s.statement,
        clean(s.data.changedConditions) && `**What changes.** ${clean(s.data.changedConditions)}`,
        clean(s.data.strategy) && `**The first move.** ${clean(s.data.strategy)}`,
        strings(s.data.downstreamEffects).length > 0 &&
          `**What follows.**\n${strings(s.data.downstreamEffects).map((e) => `- ${clean(e)}`).join('\n')}`,
        clean(s.data.detectability) && `**Would anyone see it?** ${clean(s.data.detectability)}`,
        clean(s.data.correction) && `**What would correct it.** ${clean(s.data.correction)}`,
      ]),
    ),
  ]);
}

/** The written chapters, in the report's own five acts. */
function chapters(artefacts: Artefact[]): string {
  const bySection = new Map(findingsBySection(artefacts).map((s) => [s.section, s]));
  const recommendations = of(artefacts, 'recommendation');
  const acts = REPORT_ACTS.map((act) => {
    const parts = act.sections
      .map((section) => bySection.get(section))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((chapter) =>
        block([`### ${chapter.label}`, ...chapter.items.map((item) => block([`**${item.label}.** ${item.statement}`]))]),
      );
    return parts.length ? block([`## ${act.title}`, act.strap, ...parts]) : '';
  }).filter(Boolean);

  const recs = recommendations.length
    ? block([
        '## Redesign options',
        ...recommendations.map((r) =>
          block([
            `### ${r.label}`,
            r.statement,
            clean(r.data.change) && `**The change.** ${clean(r.data.change)}`,
            clean(r.data.tradeoffs) && `**What it costs.** ${clean(r.data.tradeoffs)}`,
            clean(r.data.validationNeeded) && `**Before adopting it.** ${clean(r.data.validationNeeded)}`,
          ]),
        ),
      ])
    : '';

  return block([...acts, recs]);
}

/** What the assessment could not establish. Never dropped — a silent omission is worse. */
function limits(meta: DocMeta): string {
  if (!meta.warnings?.length) return '';
  return block([
    '## What this assessment could not establish',
    'Every limit the run recorded about itself, in the order the stages ran.',
    meta.warnings.map((w) => `- *${w.stage}* — ${w.text}`).join('\n'),
  ]);
}


/**
 * THE KEY, AS AN APPENDIX.
 *
 * The exported document uses the same vocabulary as the page — plays, exposure,
 * concealment, standing, structural checks — and until now defined none of it.
 * A Word file lands on somebody's desk with nobody to ask, which makes the
 * appendix more necessary in the export than it is on screen, where a hover
 * card is one pointer away.
 *
 * It renders from `glossary.ts`, the same module `KeyPanel.svelte` reads, so the
 * screen and the document cannot drift into two different definitions of
 * "exposure".
 */
function key(): string {
  const sections = KEY_SECTIONS.map((section) =>
    block([
      `### ${section.title}`,
      section.blurb,
      // ONE PARAGRAPH PER TERM, not a four-item sub-list. As nested bullets the
      // appendix ran to about eight Word pages on its own and dwarfed the
      // assessment it was appended to; the same words as a run-on paragraph are
      // half the length and read better in a document than on a screen.
      section.terms
        .map((t) => {
          const name = t.plain && t.plain !== t.label ? `**${t.plain}** (${t.label.toLowerCase()})` : `**${t.label}**`;
          const parts = [`${name} — ${t.what}`, t.why, `Reading it: ${t.read}`];
          if (t.formula) parts.push(`Worked out as: ${t.formula}`);
          return `- ${parts.join(' ')} *(${t.provenance})*`;
        })
        .join('\n'),
    ]),
  );

  return block([
    '## How to read this assessment',
    'This is a game-theoretic read of a policy paper, and its vocabulary says so. Everything the document uses is defined here, with the arithmetic written out wherever a figure is computed rather than judged.',
    '### How the pieces join',
    READING_CHAIN.map((link, i) => `${i + 1}. **${link.step}** ${link.then}`).join('\n'),
    ...sections,
  ]);
}

/**
 * The whole document.
 *
 * Sections that produced nothing are absent rather than present-and-empty: a
 * heading with "no data" under it in a Word file reads as a defect in the
 * export, and the cover already says what the run reached.
 */
export function assessmentMarkdown(artefacts: Artefact[], meta: DocMeta): string {
  return block([
    cover(meta, artefacts),
    verdict(artefacts),
    playbook(artefacts),
    cast(artefacts),
    relationships(artefacts),
    foundations(artefacts),
    structure(artefacts),
    scenarios(artefacts),
    chapters(artefacts),
    limits(meta),
    // Last, because it is a reference rather than a reading — and present in
    // every copy, owner or shared, because the words are the same in both.
    key(),
  ]).replace(/\n{3,}/g, '\n\n') + '\n';
}

/** `Post-16 Education and Skills` → `post-16-education-and-skills`. */
export function documentSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'policy-assessment';
}
