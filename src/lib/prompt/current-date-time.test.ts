import { describe, expect, it } from 'vitest';

import { injectCurrentDateTime } from '$lib/prompt/current-date-time';

const now = new Date('2026-08-17T14:30:45.000Z');

describe('injectCurrentDateTime', () => {
	it('appends current date/time context to system messages without mutating input', () => {
		const messages = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'What day is it?' }
		];

		const result = injectCurrentDateTime(messages, { now });

		expect(messages[0].content).toBe('You are a helpful assistant.');
		expect(result[0].content).toContain('You are a helpful assistant.');
		expect(result[0].content).toContain('Canonical timestamp: 2026-08-17T14:30:45.000Z.');
		expect(result[1]).toEqual(messages[1]);
	});

	it('prepends a system message when none exists', () => {
		const result = injectCurrentDateTime([{ role: 'user', content: 'Hello' }], { now });

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ role: 'system' });
		expect(result[0].content).toContain('2026-08-17T14:30:45.000Z');
	});

	it('replaces an earlier injected context instead of accumulating duplicates', () => {
		const first = injectCurrentDateTime([{ role: 'system', content: 'Base rules' }], { now });
		const second = injectCurrentDateTime(first, {
			now: new Date('2026-08-18T09:00:00.000Z')
		});

		expect(second[0].content.match(/<current-date-time>/g)).toHaveLength(1);
		expect(second[0].content).toContain('2026-08-18T09:00:00.000Z');
		expect(second[0].content).not.toContain('2026-08-17T14:30:45.000Z');
	});
});
