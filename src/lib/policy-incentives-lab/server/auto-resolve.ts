import { SYNTHETIC_TEXT } from '../synthetic';
import { guidedModel } from '../guided-model';
import { prepareIllustrative } from '../auto-resolve';
import type { Draft } from './store';
import { ProposalError, propose, type ProposalTransport } from './extraction';

export async function proposeIllustrative(draft: Draft, options: unknown, transport: ProposalTransport | null) {
  if (!draft.source) throw new Error('Load a policy first');
  let candidate = draft.candidate; const attempts: Draft['attempts'] = [];
  if (!candidate && (transport || (draft.source.synthetic && draft.source.text_sections.map(s => s.text).join('\n') === SYNTHETIC_TEXT))) {
    const proposal = await propose(draft.source, 'extract-objectives', null, transport);
    attempts.push(...proposal.attempts); if ('game' in proposal.output) candidate = proposal.output;
  }
  if (!candidate) {
    // Explicitly hypothetical fallback: neither source extraction nor a finding.
    const names = (draft.first_look?.content.actors.map(a => a.title.slice(0, 150)) ?? []).filter((name, index, all) => all.findIndex(n => n.toLowerCase().replace(/s$/, '') === name.toLowerCase().replace(/s$/, '')) === index).slice(0, 2);
    candidate = guidedModel({ intended: 'Illustrative exploration of the loaded policy; confirm the actual intended outcome.', mechanism: 'Hypothetical change in the rewards and constraints faced by these groups.', metric: 'Illustrative outcome score', unit: 'illustrative points', people: [0, 1].map(i => ({ name: names[i] || (i ? 'Hypothetical affected group' : 'Hypothetical delivery group'), wants: 'Improve its own illustrative outcome', first: 'Keep current approach', second: 'Change approach' })) }, 'automatic illustrative starter');
    candidate.game.assumptions[0].confidence = 'illustrative'; candidate.game.assumptions[0].source = 'Automatic illustrative starter; group names may come from unreviewed first-look hypotheses. Not entered by a human.';
  }
  let proposal = prepareIllustrative(candidate, draft.source, options);
  if (proposal.errors.length && transport) {
    try {
    const repair = await propose(draft.source, 'propose-strategies', candidate, transport, { validation_issues_to_resolve: proposal.errors });
    attempts.push(...repair.attempts); if ('game' in repair.output) proposal = prepareIllustrative(repair.output, draft.source, options);
    } catch (e) { if (e instanceof ProposalError) e.attempts.unshift(...attempts); throw e; }
  }
  return { proposal, attempts };
}
