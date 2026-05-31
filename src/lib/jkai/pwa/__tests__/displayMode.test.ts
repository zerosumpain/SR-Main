import { describe, it, expect, vi } from 'vitest';
import { isStandalone } from '../displayMode';

describe('isStandalone', () => {
	it('returns true when matchMedia standalone matches', () => {
		vi.stubGlobal('window', {
			matchMedia: (q: string) => ({ matches: q.includes('standalone') }),
			navigator: {}
		});
		expect(isStandalone()).toBe(true);
	});

	it('returns true on iOS standalone flag', () => {
		vi.stubGlobal('window', {
			matchMedia: () => ({ matches: false }),
			navigator: { standalone: true }
		});
		expect(isStandalone()).toBe(true);
	});

	it('returns false in regular browser', () => {
		vi.stubGlobal('window', {
			matchMedia: () => ({ matches: false }),
			navigator: { standalone: false }
		});
		expect(isStandalone()).toBe(false);
	});

	it('returns false when window undefined (SSR)', () => {
		vi.stubGlobal('window', undefined);
		expect(isStandalone()).toBe(false);
	});
});
