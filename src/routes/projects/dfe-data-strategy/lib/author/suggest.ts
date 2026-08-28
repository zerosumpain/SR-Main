// suggest.ts — suggested lines for each Author section, written deterministically from
// two live sources: the workbench diagnostic (the posture, allocation, coverage, tensions
// and maturity the lead has actually set) and the frameworks an education-department strategy should consider
// (weighted foundational → specialist). No LLM: every line quotes the lead's own numbers
// or a named framework, is honest about where it came from, and is theirs to edit or bin.

import { POSTURE_BY_ID } from '../postures';
import { CAPABILITY_BY_ID, CAPABILITY_IDS } from '../capabilities';
import { PRESSURES_BY_ID } from '$lib/dfe-data-strategy/pressures';
import { MATURITY_DIMENSIONS } from '$lib/dfe-data-strategy/maturity';
import { LEGISLATION_BY_ID } from '$lib/dfe-data-strategy/legislation';
import { FRAMEWORKS } from '$lib/dfe-data-strategy/frameworks';
import { MUST_ANSWER } from '../commitments';
import { pct } from '../format';
import type { AlignmentResult, StrategyState } from '$lib/dfe-data-strategy/types';

export interface SuggestedLine {
  id: string;
  /** The line itself — plain prose, ready to insert as a paragraph. */
  text: string;
  /** Where it came from (shown as a chip so the writer can judge it). */
  source: 'diagnostic' | 'framework';
  label: string;
}

export interface SuggestContext {
  state: StrategyState;
  align: AlignmentResult;
  scenarioName: string;
}

const FW_BY_ID = Object.fromEntries(FRAMEWORKS.map((f) => [f.id, f]));

// ---- readings of the diagnostic ----

/** A worded read of one posture axis: 'balanced' | leaning left | leaning right. */
function lean(ctx: SuggestContext, axisId: string): { side: 'left' | 'right' | 'balanced'; strength: number; ax: (typeof POSTURE_BY_ID)[string] } | null {
  const ax = POSTURE_BY_ID[axisId];
  if (!ax) return null;
  const v = ctx.state.postures[axisId] ?? 0;
  if (Math.abs(v) < 0.12) return { side: 'balanced', strength: 0, ax };
  return { side: v < 0 ? 'left' : 'right', strength: Math.round(Math.abs(v) * 100), ax };
}

/** Effort share (0–100) and effective strength (0–1) of a capability. */
function cap(ctx: SuggestContext, id: string): { share: number; strength: number; name: string } {
  const total = CAPABILITY_IDS.reduce((s, k) => s + (ctx.state.allocation[k] ?? 0), 0) || 1;
  return {
    share: Math.round(((ctx.state.allocation[id] ?? 0) / total) * 100),
    strength: ctx.align.capability[id] ?? 0,
    name: CAPABILITY_BY_ID[id]?.name ?? id,
  };
}

function weakestPressures(ctx: SuggestContext, n = 2): { title: string; coverage: number }[] {
  return Object.entries(ctx.align.coverage)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([id, c]) => ({ title: PRESSURES_BY_ID[id]?.title ?? id, coverage: c }));
}

function maturityGaps(ctx: SuggestContext, n = 2): { name: string; cur: number; tgt: number; proj: number }[] {
  return MATURITY_DIMENSIONS.map((d) => ({
    name: d.name,
    cur: ctx.state.maturityCurrent[d.id] ?? 2,
    tgt: ctx.state.maturityTarget[d.id] ?? 4,
    proj: ctx.align.maturityProjected[d.id] ?? 0,
  }))
    .sort((a, b) => b.tgt - b.cur - (a.tgt - a.cur))
    .slice(0, n);
}

function earliestMustAnswer(): { title: string; timeframe: string } | null {
  const dated = MUST_ANSWER.filter((c) => c.timeframeDate).sort((a, b) => (a.timeframeDate! < b.timeframeDate! ? -1 : 1));
  const c = dated[0];
  return c ? { title: c.title, timeframe: c.timeframe ?? c.timeframeDate! } : null;
}

// ---- the per-section rules ----

type LineBuilder = (ctx: SuggestContext) => SuggestedLine[];

const d = (id: string, text: string): SuggestedLine => ({ id, text, source: 'diagnostic', label: 'from your diagnostic' });
const f = (id: string, fwId: string, text: string): SuggestedLine => ({
  id,
  text,
  source: 'framework',
  label: FW_BY_ID[fwId]?.name ?? 'framework',
});

const RULES: Record<string, LineBuilder> = {
  vision: (ctx) => {
    const out: SuggestedLine[] = [];
    const weak = weakestPressures(ctx, 1)[0];
    out.push(
      d(
        'vision-coverage',
        `Tested against the ${Object.keys(ctx.align.coverage).length} live pressures on the department, our chosen posture (“${ctx.scenarioName}”) currently answers ${pct(ctx.align.overallCoverage)} of the severity-weighted demand — the case for change starts with what it leaves exposed${weak ? `, above all ${weak.title.toLowerCase()} (${pct(weak.coverage)} covered)` : ''}.`,
      ),
    );
    const amb = lean(ctx, 'ambition');
    if (amb && amb.side !== 'balanced') {
      out.push(
        d(
          'vision-ambition',
          amb.side === 'left'
            ? `This strategy chooses foundations first: we will fix the plumbing — quality, standards, governance — before chasing new analytical and AI value, and we will say so plainly.`
            : `This strategy chooses use-first ambition: we will pull value and AI forward deliberately, while naming the quality and governance debt that pace creates and how we will pay it down.`,
        ),
      );
    }
    out.push(
      f(
        'vision-mdg',
        'modern-digital-government',
        `Our direction of travel is set against A Blueprint for Modern Digital Government: the National Data Library and the cross-government digital backbone are fixed points this strategy must meet, not options to consider.`,
      ),
    );
    return out;
  },

  principles: (ctx) => {
    const out: SuggestedLine[] = [];
    const open = lean(ctx, 'openness');
    if (open) {
      out.push(
        d(
          'prin-openness',
          open.side === 'left'
            ? `Data is shared by default within the law: openness is a stated bias of this strategy, and every exception must be named, owned and time-limited.`
            : open.side === 'right'
              ? `Children's data demands a higher bar of care: this strategy is secure by default, and every new use must earn its way past that bar with a named basis and a named owner.`
              : `We hold openness and protection in deliberate balance: shared by default within the law, secure by design in every flow — and where the two collide, the decision is escalated, not fudged.`,
        ),
      );
    }
    out.push(
      f(
        'prin-ethics',
        'data-ethics-framework',
        `Every data and AI initiative will be assessed against the seven principles of the Data and AI Ethics Framework — transparency, accountability, fairness, privacy, safety, societal impact and environmental sustainability — before it ships.`,
      ),
    );
    return out;
  },

  'users-needs': (ctx) => {
    const sh = cap(ctx, 'sharing');
    const weak = weakestPressures(ctx, 2);
    return [
      d(
        'users-sharing',
        `Partner data-sharing and linkage currently runs at ${pct(sh.strength)} effective strength on ${sh.share}% of effort — the users this strategy must design for first are the ones outside the department: schools, trusts, local authorities and the safeguarding partners the new duties connect us to.`,
      ),
      d(
        'users-weak',
        weak.length
          ? `The diagnostic's least-answered pressures — ${weak.map((w) => w.title.toLowerCase()).join(' and ')} — are user needs in disguise; this section names whose need each one is and what they cannot currently do.`
          : `Each pressure in the landscape is a user need in disguise; this section names whose need it is and what they cannot currently do.`,
      ),
      f(
        'users-gdqf',
        'gov-data-quality',
        `Following the Government Data Quality Framework's first discipline — know your users and their needs — every dataset we hold will carry a statement of who uses it, for what decision, at what quality.`,
      ),
    ];
  },

  'commitments-obligations': (ctx) => {
    const out: SuggestedLine[] = [];
    const first = earliestMustAnswer();
    out.push(
      d(
        'commit-tensions',
        `The diagnostic currently flags ${ctx.align.tensions.length === 0 ? 'no unresolved tensions' : `${ctx.align.tensions.length} unresolved tension${ctx.align.tensions.length === 1 ? '' : 's'}`} in our posture${ctx.align.tensions.length ? ` (${ctx.align.tensions.map((t) => t.title.toLowerCase()).slice(0, 2).join('; ')}${ctx.align.tensions.length > 2 ? '; …' : ''})` : ''} — this section shows how each binding commitment survives them.`,
      ),
    );
    if (first) {
      out.push(
        d(
          'commit-earliest',
          `The clock is already running: the earliest hard obligation on the ledger — ${first.title.toLowerCase()} — lands ${first.timeframe}, and the delivery plan in this strategy is sequenced back from that date.`,
        ),
      );
    }
    return out;
  },

  'architecture-platforms': (ctx) => {
    const out: SuggestedLine[] = [];
    const om = lean(ctx, 'operating-model');
    const bb = lean(ctx, 'build-buy');
    if (om) {
      out.push(
        d(
          'arch-om',
          om.side === 'left'
            ? `The target architecture is deliberately centralised: a single platform team owns the spine, the canonical stores and the pipelines, and domain teams consume through governed services.`
            : om.side === 'right'
              ? `The target architecture is deliberately federated: domains own their data as products against common standards, and the centre's job is the connective tissue — identifiers, contracts, catalogue — not the warehouse.`
              : `The target architecture balances a strong central spine with domain ownership at the edge: the centre holds identifiers, standards and the catalogue; domains hold their data and its quality.`,
        ),
      );
    }
    if (bb && bb.side !== 'balanced') {
      out.push(
        d(
          'arch-bb',
          bb.side === 'right'
            ? `We buy before we build (${bb.strength}% toward buy/SaaS in the current posture): commodity capability comes from the market, and internal engineering is reserved for what is genuinely distinctive to education data.`
            : `We build before we buy (${bb.strength}% toward in-house in the current posture): the platform is a long-lived capability we intend to own, staff and understand — not rent.`,
        ),
      );
    }
    const om2 = lean(ctx, 'operating-model');
    out.push(
      om2?.side === 'right'
        ? f(
            'arch-mesh',
            'data-mesh',
            `The federated model follows Data Mesh's discipline, not its fashion: domain ownership, data as a product, self-serve platform, federated computational governance — each named with an owner and a measure.`,
          )
        : f(
            'arch-mdg',
            'modern-digital-government',
            `The estate plugs into the cross-government digital backbone: National Data Library patterns for research access, shared components before bespoke builds, and APIs as the default boundary.`,
          ),
    );
    return out;
  },

  'standards-interoperability': (ctx) => {
    const sp = lean(ctx, 'standards-pace');
    const io = cap(ctx, 'interoperability');
    const out: SuggestedLine[] = [];
    if (sp) {
      out.push(
        d(
          'std-pace',
          sp.side === 'left'
            ? `We standardise now: identifiers, reference data and exchange standards are fixed up-front (${sp.strength ? `${sp.strength}% toward standardise-now` : 'a deliberate posture'}), because every year of delay multiplies the cost of joining data up later.`
            : sp.side === 'right'
              ? `We let standards emerge from delivery: rather than a two-year standards programme, each delivery fixes the standard it needs, and the interoperability function hardens what proves itself.`
              : `We run standards and delivery in tandem: a small set of non-negotiables (identifiers, core reference data) fixed now, everything else standardised as delivery proves the need.`,
        ),
      );
    }
    out.push(
      d('std-strength', `Interoperability and standards currently run at ${pct(io.strength)} effective strength on ${io.share}% of effort — this section says which standards, whose, and by when.`),
      f(
        'std-cddo',
        'cddo-roadmap',
        `We adopt before we invent: CDDO-lineage standards — the API catalogue, DCAT metadata, common reference data under a single data-ownership model — are the default, and a department-specific standard needs a written case.`,
      ),
    );
    return out;
  },

  identifiers: (ctx) => {
    const idp = ctx.align.coverage['consistent-child-identifier'];
    const spine = ctx.align.coverage['data-spine'];
    const out: SuggestedLine[] = [];
    out.push(
      d(
        'id-coverage',
        `Under the current posture the identifier and spine pressures are ${idp !== undefined ? `${pct(idp)} and ${spine !== undefined ? pct(spine) : '—'} covered respectively` : 'only partially covered'} — this section commits to the consistent child identifier as the strategy's single most consequential dependency, with a named owner and date.`,
      ),
    );
    out.push(
      f(
        'id-mdg',
        'modern-digital-government',
        `Identifier design follows the cross-government direction: one canonical identifier per entity, matched once at the spine, never re-derived locally — so every partner joins to the same child, learner and setting.`,
      ),
    );
    return out;
  },

  'data-quality': (ctx) => {
    const q = cap(ctx, 'quality');
    return [
      d(
        'dq-strength',
        `Data quality and management currently runs at ${pct(q.strength)} effective strength on ${q.share}% of effort — ${q.strength < 0.5 ? 'below where a register-holding, spine-building department can afford to be' : 'a base this strategy builds on rather than apologises for'}.`,
      ),
      f(
        'dq-gdqf',
        'gov-data-quality',
        `Quality is measured, not asserted: every critical dataset is scored on the six Government Data Quality Framework dimensions — completeness, uniqueness, consistency, timeliness, validity, accuracy — and the scores are published to its users.`,
      ),
    ];
  },

  'governance-ownership': (ctx) => {
    const g = cap(ctx, 'governance');
    const om = lean(ctx, 'operating-model');
    return [
      d(
        'gov-strength',
        `Governance and the operating model run at ${pct(g.strength)} effective strength on ${g.share}% of effort${om && om.side !== 'balanced' ? `, in a ${om.side === 'left' ? 'centralised' : 'federated'} model — so decision rights must be written for that shape, not borrowed from the other` : ''} — every dataset gets a named owner and a named steward, and the list is public inside the department.`,
      ),
      f(
        'gov-dama',
        'dama-dmbok',
        `The governance function is scoped against DAMA-DMBOK's knowledge areas — so "governance" means the full estate (architecture, quality, metadata, security, lifecycle), not a committee that meets quarterly.`,
      ),
      f(
        'gov-dma',
        'dma-government',
        `Leadership accountability follows the Data Maturity Assessment's first theme: a named senior owner for data on the board, with the maturity score in their objectives.`,
      ),
    ];
  },

  'legal-basis': (ctx) => {
    const names = ctx.align.legalImplicated
      .map((lid) => LEGISLATION_BY_ID[lid]?.name)
      .filter(Boolean)
      .slice(0, 3);
    return [
      d(
        'legal-implicated',
        `The current posture implicates ${ctx.align.legalImplicated.length || 'several'} instruments in the legal registry${names.length ? ` — starting with ${names.join(', ')}` : ''} — and every new flow this strategy creates will name all three layers before it ships: the data-protection basis, the statutory gateway, and the governance instrument.`,
      ),
      d(
        'legal-vires',
        `We do not confuse a lawful basis with a legal power: having a UK GDPR basis to process is not the vires to share, and this strategy treats the distinction as a design input, not a legal review finding.`,
      ),
    ];
  },

  'ethics-trust': (ctx) => {
    const e = cap(ctx, 'ethics');
    const open = lean(ctx, 'openness');
    return [
      d(
        'eth-strength',
        `Ethics, trust and transparency run at ${pct(e.strength)} effective strength on ${e.share}% of effort${open?.side === 'left' ? ' — and an open-by-default posture raises, not lowers, the transparency bar this section must set' : ''}: public trust is the licence every other section spends.`,
      ),
      f(
        'eth-atrs',
        'atrs',
        `Every algorithmic or AI tool that affects children, learners or institutions gets a published Algorithmic Transparency Recording Standard record — the two-tier record, in the central repository, before deployment.`,
      ),
      f(
        'eth-def',
        'data-ethics-framework',
        `Ethics review is built into delivery, not bolted on: the Data and AI Ethics Framework self-assessment runs at design time for every new use of children's data, alongside the DPIA.`,
      ),
    ];
  },

  'workforce-culture': (ctx) => {
    const s = cap(ctx, 'skills');
    return [
      d(
        'wf-strength',
        `Skills, capacity and literacy run at ${pct(s.strength)} effective strength on ${s.share}% of effort — ${s.share < 12 ? 'the thinnest slice of the allocation, which this section must either defend or correct' : 'and this section turns that investment into named professions, career paths and literacy floors'}.`,
      ),
      f(
        'wf-dma',
        'dma-government',
        `We measure culture as well as headcount: the Data Maturity Assessment's Skills and Culture themes are scored annually, and the gap between them drives the learning offer.`,
      ),
      f(
        'wf-cddo',
        'cddo-roadmap',
        `Data fluency is a leadership requirement, not a specialist nicety — in the spirit of the digital roadmap's ambition that ~90% of senior civil servants are data-upskilled, every SCS objective includes one data-informed decision they own.`,
      ),
    ];
  },

  'analytics-ai': (ctx) => {
    const v = cap(ctx, 'value');
    const amb = lean(ctx, 'ambition');
    return [
      d(
        'ai-strength',
        `Use, decisions and value run at ${pct(v.strength)} effective strength on ${v.share}% of effort${amb && amb.side !== 'balanced' ? ` under a ${amb.side === 'right' ? 'use-first' : 'foundations-first'} posture` : ''} — this section names the decisions analytics must improve, before it names the tools.`,
      ),
      f(
        'ai-opps',
        'ai-opportunities',
        `The department is a named delivery partner of the AI Opportunities Action Plan, which calls high-quality data "the lifeblood of modern AI" — our AI ambitions are therefore sequenced behind the data foundations they depend on, and say so.`,
      ),
    ];
  },

  'open-data-research': (ctx) => {
    const open = lean(ctx, 'openness');
    return [
      d(
        'open-posture',
        open?.side === 'right'
          ? `A secure-by-default posture makes the research offer more important, not less: what we cannot open we make safely accessible — accredited researchers, secure environments, published metadata for everything.`
          : `Openness is only real if it is usable: open data ships with its metadata, its quality score and its licence, and the measure of success is external reuse, not publication counts.`,
      ),
      f(
        'open-ndl',
        'modern-digital-government',
        `Research access routes through the National Data Library pattern — secure, accredited, once-only linkage — rather than bespoke extracts, so the department answers research demand without multiplying risk.`,
      ),
      f(
        'open-nds',
        'national-data-strategy',
        `The National Data Strategy's availability mission still sets the test: data that is findable, well-described and fit for reuse across government — this section says which the department datasets meet it, and when the rest will.`,
      ),
    ];
  },

  security: (ctx) => {
    const p = cap(ctx, 'platform');
    const g = cap(ctx, 'governance');
    return [
      d(
        'sec-base',
        `Security rides on the platform (${pct(p.strength)} effective strength) and governance (${pct(g.strength)}) investments — this section sets the controls for the highest-stakes estate in government: longitudinal records about children.`,
      ),
      f(
        'sec-cdmc',
        'cdmc',
        `Cloud controls follow the CDMC framework's key controls for sensitive data in the cloud — cataloguing, classification, entitlements, lineage — so "secure" is a checklist with evidence, not an adjective.`,
      ),
    ];
  },

  'delivery-roadmap': (ctx) => {
    const del = lean(ctx, 'delivery');
    const first = earliestMustAnswer();
    const out: SuggestedLine[] = [];
    if (del) {
      out.push(
        d(
          'del-mode',
          del.side === 'right'
            ? `Delivery is partner-led by choice (${del.strength}% in the current posture): LAs, trusts and agencies carry delivery where they are closer to the data, and the department's job is standards, funding and assurance.`
            : del.side === 'left'
              ? `Delivery is held in-house by choice (${del.strength}% in the current posture): the department keeps direct control of quality and pace on the flows that matter most, and buys reach only where it must.`
              : `Delivery is mixed by design: in-house where control of quality is decisive, partner-led where reach is — and the roadmap names which is which for every major milestone.`,
        ),
      );
    }
    if (first) {
      out.push(d('del-anchor', `The roadmap is anchored on the hardest external date first — ${first.title.toLowerCase()}, ${first.timeframe} — and works backwards; internal ambitions flex, statutory dates do not.`));
    }
    return out;
  },

  funding: (ctx) => {
    const ranked = CAPABILITY_IDS.map((id) => cap(ctx, id)).sort((a, b) => b.share - a.share);
    const top = ranked.slice(0, 2);
    return [
      d(
        'fund-shape',
        `The investment case follows the diagnostic's shape: effort is weighted toward ${top.map((t) => `${t.name.toLowerCase()} (${t.share}%)`).join(' and ')} — and this section prices that split, names what is deliberately underfunded, and says what changes if the settlement shrinks.`,
      ),
      d(
        'fund-honesty',
        `Every capability line carries its consequence: for each area we state what the funded level buys, and what the department accepts by not funding more — so the trade-offs are made once, in writing, not annually by accident.`,
      ),
    ];
  },

  measurement: (ctx) => {
    const gaps = maturityGaps(ctx, 2);
    return [
      d(
        'meas-maturity',
        gaps.length
          ? `The maturity self-assessment sets the baseline: the widest gaps are ${gaps.map((g) => `${g.name.toLowerCase()} (${g.cur} → target ${g.tgt}, projected ${g.proj.toFixed(1)})`).join(' and ')} — these are the numbers this strategy will be marked against.`
          : `The maturity self-assessment sets the baseline, and every target in this section is a number someone can check.`,
      ),
      f(
        'meas-dma',
        'dma-government',
        `We re-score the Data Maturity Assessment for Government annually across all six themes, publish the movement to the board, and let the lowest-scoring theme claim first call on next year's investment.`,
      ),
    ];
  },
};

/** Suggested lines for a section (empty for custom sections with no template). */
export function suggestLines(templateId: string | null, ctx: SuggestContext): SuggestedLine[] {
  if (!templateId) return [];
  const rule = RULES[templateId];
  return rule ? rule(ctx) : [];
}
