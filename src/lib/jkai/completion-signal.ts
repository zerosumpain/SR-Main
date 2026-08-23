/**
 * Does an iteration's evaluation say the work is finished?
 *
 * Lives in its own module with no imports: `orchestrator.ts` reaches
 * `$lib/workflows`, whose module-level side effects dial WhatsApp for real
 * under vitest. A pure helper that wants a unit test cannot live there.
 *
 * The percentage branch was unreachable from the day it was written. Greedy
 * `[^.]{0,30}` backtracks from the longest match, so `(\d+)` captured only the
 * last digit — "progress is 100%" scored 0, "overall 95%" scored 5, and
 * `>= 95` never held. The quantifiers below are lazy for that reason; don't
 * make them greedy again.
 */

/** An explicit verdict from the agent beats anything we infer from prose. */
const STATUS_COMPLETE_RE = /^[^\S\n]*status:[^\S\n]*complete\b/im;
const STATUS_CONTINUE_RE = /^[^\S\n]*status:[^\S\n]*continue\b/im;

/**
 * A completion percentage anchored to progress language, so "95% of tests
 * passing" doesn't read as done. `complet(?:e|ed|ion)` because "completion" —
 * the word the prompt itself asks for — does not contain "complete".
 */
const PCT_RE =
	/(?:progress|complet(?:e|ed|ion)|done|goal|finished|overall)[^.]{0,30}?(\d+)\s*%|(\d+)\s*%[^.]{0,30}?(?:complet(?:e|ed|ion)|done|finished|overall)/;

const COMPLETION_PHRASES = [
	'project is complete',
	'project complete',
	'all features implemented',
	'all features have been implemented',
	'fully complete',
	'fully implemented',
	'nothing remains',
	'no remaining work',
	'all goals achieved',
	'all objectives met',
	'everything is working',
	'all requirements met',
	'all requirements have been met',
	'project is finished',
	'build is complete',
];

export function detectCompletion(evaluation: string | null): boolean {
	if (!evaluation) return false;

	// An explicit CONTINUE is the agent telling us not to stop. It outranks
	// every heuristic below — that is the brake on a premature termination.
	if (STATUS_CONTINUE_RE.test(evaluation)) return false;
	if (STATUS_COMPLETE_RE.test(evaluation)) return true;

	const lower = evaluation.toLowerCase();

	const pctMatch = lower.match(PCT_RE);
	const pctValue = pctMatch ? parseInt(pctMatch[1] || pctMatch[2]) : 0;
	if (pctValue >= 95) return true;

	return COMPLETION_PHRASES.some((phrase) => lower.includes(phrase));
}
