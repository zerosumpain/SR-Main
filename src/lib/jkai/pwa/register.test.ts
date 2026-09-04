import { describe, expect, it } from 'vitest';
import { buildIdFrom, isDifferentBuild, isJkaiScope, isLegacyJkaiScope, shortBuildId } from './register';

describe('JKAI PWA build identity', () => {
	it('compares the content tree rather than the deploy commit', () => {
		const version = { sha: 'new-merge-commit', short: 'new-merg', tree: 'same-tree' };
		expect(buildIdFrom(version)).toBe('same-tree');
		expect(isDifferentBuild(version, 'same-tree')).toBe(false);
		expect(isDifferentBuild(version, 'old-tree')).toBe(true);
	});

	it('formats the same identity used for comparison', () => {
		expect(shortBuildId('240290b3401a3b6f')).toBe('240290b3');
		expect(shortBuildId(null)).toBe('unknown');
	});

	it('refreshes both jkai registrations, and nothing outside the scope', () => {
		// healStaleJkaiSW() runs from the root layout, i.e. on every page. It must
		// touch a jkai worker and leave every other registration alone.
		expect(isJkaiScope('https://example.test/jkai', 'https://example.test')).toBe(true);
		expect(isJkaiScope('https://example.test/jkai/', 'https://example.test')).toBe(true);
		expect(isJkaiScope('https://example.test/', 'https://example.test')).toBe(false);
		expect(isJkaiScope('https://example.test/drive', 'https://example.test')).toBe(false);
		expect(isJkaiScope('https://other.test/jkai', 'https://example.test')).toBe(false);
	});

	it('only selects the obsolete trailing-slash registration', () => {
		expect(isLegacyJkaiScope('https://example.test/jkai/', 'https://example.test')).toBe(true);
		expect(isLegacyJkaiScope('https://example.test/jkai', 'https://example.test')).toBe(false);
		expect(isLegacyJkaiScope('https://other.test/jkai/', 'https://example.test')).toBe(false);
	});
});
