// policy.ts — the Policy Builder model. A user writes headline policies (natural-language
// statements about what the data strategy should include); the "consideration builder" (an
// LLM, server-side) reviews ALL the strategic material in this project PLUS a brief of the
// Policy Engine's data conclusions, and returns pros, cons, tensions, tradeoffs, impacted &
// interested stakeholders and considerations — with references back to the evidence.

import { PRESSURES } from './pressures';
import { STRATEGIES } from './strategies';
import { FRAMEWORKS } from './frameworks';
import { LEGISLATION } from './legislation';
import { MATURITY_DIMENSIONS } from './maturity';
import { SECTOR_VOICES } from './sectorVoices';

export interface StakeholderRef {
  name: string;
  why: string;
}

export interface Consideration {
  point: string;
  detail?: string;
}

export interface Tension {
  point: string;
  severity?: 'high' | 'medium' | 'low';
}

export interface EvidenceRef {
  title: string;
  url: string | null;
}

export interface Considerations {
  /** A single succinct verdict sentence shown up-front (detail expands below). */
  headline?: string;
  /** The RAG sources the appraisal was grounded in (the evidential trail). */
  evidence?: EvidenceRef[];
  summary: string;
  pros: Consideration[];
  cons: Consideration[];
  tensions: Tension[];
  tradeoffs: Consideration[];
  considerations: Consideration[]; // issues / things to weigh
  stakeholders: { impacted: StakeholderRef[]; interested: StakeholderRef[] };
  references: { pressures: string[]; strategies: string[]; legislation: string[] };
  watchouts?: string[];
}

export interface PolicyDraft {
  id: string;
  title: string;
  statement: string;
  status: 'draft' | 'analysing' | 'done' | 'error';
  considerations?: Considerations;
  error?: string;
  at: number;
}

/** Canonical stakeholders the model is nudged to choose from (free text also allowed). */
export const STAKEHOLDERS = [
  'DfE (policy & analysis)',
  'DfE data/digital function (CDO)',
  'Schools & teachers',
  'Multi-academy trusts',
  'Local authorities / children’s services',
  'Children & young people',
  'Parents & carers',
  'Health & social care partners',
  'Safeguarding partnerships',
  'Ofsted / Ofqual / STA / TRA',
  'DSIT & the centre of government',
  'ONS & the research community',
  'Third sector & children’s charities',
  'EdTech / MIS suppliers',
  'The ICO / Information Commission',
  'The public / taxpayers',
];

/** A condensed brief of the Policy Engine's data-related conclusions — so the consideration
 *  builder can weave the policy work in without a cross-project runtime call. */
export const POLICY_ENGINE_BRIEF = `FROM THE POLICY ENGINE (strangeramblings.com/projects/policy-engine) — its data-related conclusions:
- The data spine & consistent child identifier are the keystone: protecting children needs education, social care and health data joined up around one safe identifier (the "monitor" / data-spine field study).
- The "Jigsaw" problem: safeguarding fails when agencies see fragments, not the whole child — multi-agency data-sharing across different legal regimes, identifiers and duties of confidence is the hardest and highest-stakes data task.
- Daily attendance data + "similar schools" analytics power the absence drive, but only work if data flows reliably from thousands of schools and is high quality.
- SEND/EHCP: managing the high-needs funding cliff needs timely, comparable data on demand, provision and outcomes across local areas — today partial and inconsistent.
- NEET / participation: finding and supporting young people not in education or work depends on joining post-16 data across providers, LAs and the jobs/benefits system.
- The model's wider thesis: better evidence and joined-up data materially change what policy can achieve; weak data foundations cap how well the department can know what works.`;

/** Build a compact strategy-context pack for the LLM (kept well under token limits). */
export function buildStrategyContext(): string {
  const parts: string[] = [];
  parts.push('PRESSURES (id · origin · title — demands):');
  parts.push(PRESSURES.map((p) => `- ${p.id} · ${p.origin} · ${p.title} — needs: ${p.demands.join(', ')} (sev ${p.severity}/5)`).join('\n'));
  parts.push('\nSTRATEGY INFLUENCE MAP (id · verdict · name — take):');
  parts.push(STRATEGIES.map((s) => `- ${s.id} · ${s.tier} · ${s.name} — ${s.take}`).join('\n'));
  parts.push('\nLEGAL STACK (id · layer · name — relevance):');
  parts.push(LEGISLATION.map((l) => `- ${l.id} · ${l.layer} · ${l.name} — ${l.relevance}`).join('\n'));
  parts.push('\nFRAMEWORKS (name — summary):');
  parts.push(FRAMEWORKS.map((f) => `- ${f.name}: ${f.summary}`).join('\n'));
  parts.push('\nMATURITY DIMENSIONS (DMA themes): ' + MATURITY_DIMENSIONS.map((d) => d.name).join(', '));
  if (SECTOR_VOICES.length) {
    parts.push('\nSECTOR VOICES (who · stance — point):');
    parts.push(SECTOR_VOICES.slice(0, 24).map((v) => `- ${v.who} (${v.group}, ${v.stance}): ${v.point}`).join('\n'));
  }
  parts.push('\n' + POLICY_ENGINE_BRIEF);
  return parts.join('\n');
}

/** A short brief for the specific item a "draft policies" suggester was opened for. */
export function targetBrief(kind: string, id: string, label: string): string {
  if (kind === 'strategy') {
    const s = STRATEGIES.find((x) => x.id === id);
    return s ? `STRATEGY: ${s.name} (verdict: ${s.tier}). "${s.take}" Why it matters to DfE: ${s.whyDfE}` : `STRATEGY: ${label}`;
  }
  if (kind === 'pressure') {
    const p = PRESSURES.find((x) => x.id === id);
    return p ? `PRESSURE (${p.origin}): ${p.title}. ${p.description} It demands: ${p.demands.join(', ')}.` : `PRESSURE: ${label}`;
  }
  return `STAKEHOLDER GROUP: ${label}. Suggest policies that address what this group needs from, or fears about, DfE's data strategy.`;
}

/** Compact id→name index so the model can cite any pressure/strategy/law even when it
 *  isn't in the retrieved evidence. Kept small; the substance comes from the RAG. */
export function referenceIndex(): string {
  return [
    'PRESSURES (id — title): ' + PRESSURES.map((p) => `${p.id} — ${p.title}`).join('; '),
    'STRATEGIES (id — name): ' + STRATEGIES.map((s) => `${s.id} — ${s.name}`).join('; '),
    'LEGISLATION (id — name): ' + LEGISLATION.map((l) => `${l.id} — ${l.name}`).join('; '),
  ].join('\n');
}

/** Valid reference ids for validating the model's output. */
export const VALID_REFS = {
  pressures: new Set(PRESSURES.map((p) => p.id)),
  strategies: new Set(STRATEGIES.map((s) => s.id)),
  legislation: new Set(LEGISLATION.map((l) => l.id)),
};
