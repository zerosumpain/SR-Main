import { describe, expect, it } from 'vitest';
import { detectCompletion } from '$lib/jkai/completion-signal';

/**
 * Regression cover for the greedy-quantifier bug that made the percentage
 * branch of detectCompletion unreachable. `[^.]{0,30}` backtracks from the
 * longest match, so `(\d+)` captured only the FINAL digit: "progress is 100%"
 * parsed as 0 and "overall 95%" as 5, so `pctValue >= 95` could never be true.
 * The branch fired on 3 builds in 83.
 */
describe('detectCompletion — percentage branch', () => {
	it('reads a multi-digit percentage that follows the keyword', () => {
		expect(detectCompletion('Progress is 100%')).toBe(true);
		expect(detectCompletion('Overall progress: 95%')).toBe(true);
		expect(detectCompletion('done - 100%')).toBe(true);
	});

	it('reads a percentage that precedes the keyword', () => {
		expect(detectCompletion('The project is 98% complete')).toBe(true);
		expect(detectCompletion('100% done')).toBe(true);
	});

	it('matches "completion", which does not contain the substring "complete"', () => {
		expect(detectCompletion('Completion: 100%')).toBe(true);
		expect(detectCompletion('Completion: ~95%')).toBe(true);
		expect(detectCompletion('Estimated completion: 96%')).toBe(true);
	});

	it('stays below threshold for genuine partial progress', () => {
		expect(detectCompletion('Completion is 60%')).toBe(false);
		expect(detectCompletion('Progress: 94%')).toBe(false);
		expect(detectCompletion('progress 9%')).toBe(false);
	});

	it('does not fire on an unrelated percentage', () => {
		expect(detectCompletion('95% of tests passing, feature still stubbed')).toBe(false);
		expect(detectCompletion('Reduced the bundle by 97%')).toBe(false);
	});
});

describe('detectCompletion — explicit STATUS line', () => {
	it('honours STATUS: COMPLETE', () => {
		expect(detectCompletion('## Evaluation\nAll wired up.\n\nSTATUS: COMPLETE')).toBe(true);
		expect(detectCompletion('status: complete')).toBe(true);
	});

	it('honours STATUS: CONTINUE even when the prose claims 100%', () => {
		expect(
			detectCompletion('Scaffolding is 100% complete, features pending.\n\nSTATUS: CONTINUE'),
		).toBe(false);
	});

	it('an explicit CONTINUE outranks a strong completion phrase', () => {
		expect(detectCompletion('The project is complete in outline.\nSTATUS: CONTINUE')).toBe(false);
	});
});

describe('detectCompletion — phrases and edges', () => {
	it('still matches the strong completion phrases', () => {
		expect(detectCompletion('The project is complete.')).toBe(true);
		expect(detectCompletion('All requirements met.')).toBe(true);
	});

	it('handles empty input', () => {
		expect(detectCompletion(null)).toBe(false);
		expect(detectCompletion('')).toBe(false);
	});

	it('does not fire on ordinary in-progress prose', () => {
		expect(detectCompletion('Added the chart. Next: wire the filters.')).toBe(false);
	});
});
