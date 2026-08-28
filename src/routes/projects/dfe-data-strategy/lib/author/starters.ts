// starters.ts — "insert starter text" content for the Author's guidance panel.
// Pulls real Keystone material (commitments, legislation, pressures, the current
// workbench scenario) into a section as sanitized HTML the writer then edits.
// Everything returned is honest scaffolding — findings and obligations, not
// pre-written strategy prose: the words stay the writer's job.

import { COMMITMENTS, MUST_ANSWER, DOCUMENTS_BY_ID, STATUS_META } from '../commitments';
import { LEGISLATION } from '$lib/dfe-data-strategy/legislation';
import { PRESSURES } from '$lib/dfe-data-strategy/pressures';
import { markdownToHtml } from './serialize';
import type { StrategySection } from './templates';
import type { CommitmentTheme } from '$lib/dfe-data-strategy/types';

export interface Starter {
  id: string;
  label: string;
  /** What the writer gets (shown as a hint). */
  hint: string;
  build: () => string; // returns HTML
}

function commitmentList(themes: CommitmentTheme[], cap?: string): string {
  const picked = COMMITMENTS.filter(
    (c) => themes.includes(c.theme) || (cap ? c.capabilityIds.includes(cap) : false),
  ).slice(0, 10);
  if (!picked.length) return '';
  const md = picked
    .map((c) => `- **${c.title}** (${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}, ${STATUS_META[c.status].short.toLowerCase()}) — ${c.strategyImplication}`)
    .join('\n');
  return markdownToHtml(md);
}

function mustAnswerHtml(): string {
  if (!MUST_ANSWER.length) return '';
  const md = MUST_ANSWER.slice(0, 14)
    .map((c) => `- **${c.title}** — ${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}${c.timeframe ? `, ${c.timeframe}` : ''}. ${c.strategyImplication}`)
    .join('\n');
  return markdownToHtml(`### The obligations this strategy must answer\n\n${md}`);
}

function legislationHtml(): string {
  const md = LEGISLATION.map((l) => `- **${l.name}**${l.citation ? ` (${l.citation})` : ''} — ${l.relevance}`).join('\n');
  return markdownToHtml(`### The legal stack\n\n${md}`);
}

function pressuresHtml(): string {
  const top = [...PRESSURES].sort((a, b) => b.severity * b.urgency - a.severity * a.urgency).slice(0, 8);
  const md = top.map((p) => `- **${p.title}** (${p.origin}, severity ${p.severity}/5) — ${p.description}`).join('\n');
  return markdownToHtml(`### The pressures with the most force\n\n${md}`);
}

function skeletonHtml(prompts: string[]): string {
  return markdownToHtml(prompts.map((p) => `#### ${p}\n\n…`).join('\n\n'));
}

/** The starters relevant to a given section. */
export function startersFor(section: StrategySection, prompts: string[]): Starter[] {
  const out: Starter[] = [
    {
      id: 'skeleton',
      label: 'Section skeleton',
      hint: 'The guidance questions as sub-headings to write under.',
      build: () => skeletonHtml(prompts),
    },
  ];
  const t = section.templateId;
  if (t === 'commitments-obligations') {
    out.push({
      id: 'must-answer',
      label: 'The must-answer list',
      hint: `The ${MUST_ANSWER.length} statutory and in-delivery commitments, with what each demands.`,
      build: mustAnswerHtml,
    });
  }
  if (t === 'identifiers')
    out.push({
      id: 'identifier-commitments',
      label: 'Identifier commitments',
      hint: 'Every ledger commitment about identifiers, with implications.',
      build: () => commitmentList(['identifiers']),
    });
  if (t === 'legal-basis') {
    out.push({ id: 'legal-stack', label: 'The legal stack', hint: 'The registry’s Acts, gateways and governance layers.', build: legislationHtml });
    out.push({
      id: 'statutory-commitments',
      label: 'Statutory data duties',
      hint: 'Ledger commitments that are statutory duties.',
      build: () =>
        markdownToHtml(
          COMMITMENTS.filter((c) => c.status === 'statutory-duty' || c.status === 'legislated-not-commenced')
            .slice(0, 10)
            .map((c) => `- **${c.title}** — ${c.strategyImplication}`)
            .join('\n'),
        ),
    });
  }
  if (t === 'analytics-ai')
    out.push({
      id: 'ai-commitments',
      label: 'AI & analytics commitments',
      hint: 'The ledger’s AI and analytics commitments, with implications.',
      build: () => commitmentList(['ai', 'analytics']),
    });
  if (t === 'architecture-platforms')
    out.push({
      id: 'platform-commitments',
      label: 'Platform & service commitments',
      hint: 'New services and infrastructure the estate must carry.',
      build: () => commitmentList(['new-service', 'infrastructure', 'register']),
    });
  if (t === 'standards-interoperability')
    out.push({
      id: 'standards-commitments',
      label: 'Standards commitments',
      hint: 'Standards and interoperability obligations from the ledger.',
      build: () => commitmentList(['standards'], 'interoperability'),
    });
  if (t === 'data-quality')
    out.push({
      id: 'quality-commitments',
      label: 'Quality-critical commitments',
      hint: 'Ledger commitments that lean on data quality.',
      build: () => commitmentList(['register', 'accountability'], 'quality'),
    });
  if (t === 'vision') out.push({ id: 'pressures', label: 'The top pressures', hint: 'The eight highest-force pressures, for the case for change.', build: pressuresHtml });
  if (t === 'users-needs')
    out.push({
      id: 'sharing-commitments',
      label: 'New flows & partners',
      hint: 'Data-sharing commitments that change who needs what.',
      build: () => commitmentList(['data-sharing', 'safeguarding'], 'sharing'),
    });
  return out.filter((s) => s.build().length > 0 || s.id === 'skeleton');
}
