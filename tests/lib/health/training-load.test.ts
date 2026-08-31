import { describe, it, expect } from 'vitest';
import {
	calculateACWR,
	classifyLoadZone,
	estimateStravaLoad,
} from '$lib/health/training-load-service';

describe('calculateACWR', () => {
	it('returns zeros for empty history', () => {
		const result = calculateACWR([]);
		expect(result.acute).toBe(0);
		expect(result.chronic).toBe(0);
		expect(result.ratio).toBe(0);
	});

	it('computes acute as sum of last 7 entries', () => {
		// 10 days of data, last 7 each have load=10, earlier 3 have load=5
		const history = [
			{ date: '2026-02-18', load: 5 },
			{ date: '2026-02-19', load: 5 },
			{ date: '2026-02-20', load: 5 },
			{ date: '2026-02-21', load: 10 },
			{ date: '2026-02-22', load: 10 },
			{ date: '2026-02-23', load: 10 },
			{ date: '2026-02-24', load: 10 },
			{ date: '2026-02-25', load: 10 },
			{ date: '2026-02-26', load: 10 },
			{ date: '2026-02-27', load: 10 },
		];
		const result = calculateACWR(history);
		expect(result.acute).toBe(70); // last 7: 10*7
	});

	it('computes chronic from the days preceding the acute week', () => {
		// 14 days of equal load=10 each
		const history = Array.from({ length: 14 }, (_, i) => ({
			date: `2026-02-${String(i + 1).padStart(2, '0')}`,
			load: 10,
		}));
		const result = calculateACWR(history);
		// totalLoad = 140, avgDaily = 10, chronic = 10 * 7 = 70
		expect(result.chronic).toBe(70);
		// acute = last 7 * 10 = 70
		expect(result.acute).toBe(70);
		// ratio = 70 / 70 = 1
		expect(result.ratio).toBeCloseTo(1, 5);
	});

	it('returns ratio 0 when chronic is 0 (all zeros)', () => {
		const history = [
			{ date: '2026-02-01', load: 0 },
			{ date: '2026-02-02', load: 0 },
		];
		const result = calculateACWR(history);
		expect(result.ratio).toBe(0);
	});

	it('does not manufacture a chronic baseline from the acute days', () => {
		// 3 days: loads 10, 20, 30
		const history = [
			{ date: '2026-02-25', load: 10 },
			{ date: '2026-02-26', load: 20 },
			{ date: '2026-02-27', load: 30 },
		];
		const result = calculateACWR(history);
		expect(result.chronic).toBe(0);
		// acute = sum of all 3 (< 7): 60
		expect(result.acute).toBe(60);
		expect(result.ratio).toBe(0);
	});

	it('does not dilute an acute spike by including it in chronic load', () => {
		const history = [
			...Array.from({ length: 21 }, (_, i) => ({ date: `base-${i}`, load: 10 })),
			...Array.from({ length: 7 }, (_, i) => ({ date: `acute-${i}`, load: 20 })),
		];
		const result = calculateACWR(history);
		expect(result.chronic).toBe(70);
		expect(result.acute).toBe(140);
		expect(result.ratio).toBe(2);
	});
});

describe('classifyLoadZone', () => {
	it('returns detraining for ratio < 0.6', () => {
		expect(classifyLoadZone(0)).toBe('detraining');
		expect(classifyLoadZone(0.59)).toBe('detraining');
	});

	it('returns undertraining for ratio 0.6 to < 0.8', () => {
		expect(classifyLoadZone(0.6)).toBe('undertraining');
		expect(classifyLoadZone(0.79)).toBe('undertraining');
	});

	it('returns optimal for ratio 0.8 to 1.3', () => {
		expect(classifyLoadZone(0.8)).toBe('optimal');
		expect(classifyLoadZone(1.0)).toBe('optimal');
		expect(classifyLoadZone(1.3)).toBe('optimal');
	});

	it('returns caution for ratio 1.3 to 1.5', () => {
		expect(classifyLoadZone(1.31)).toBe('caution');
		expect(classifyLoadZone(1.5)).toBe('caution');
	});

	it('returns danger for ratio > 1.5', () => {
		expect(classifyLoadZone(1.51)).toBe('danger');
		expect(classifyLoadZone(2.0)).toBe('danger');
	});
});

describe('estimateStravaLoad', () => {
	it('returns 0 when maxHr is 0', () => {
		expect(estimateStravaLoad(3600, 140, 0)).toBe(0);
	});

	it('returns 0 when maxHr is falsy (undefined coerced as 0)', () => {
		expect(estimateStravaLoad(3600, 140, 0)).toBe(0);
	});

	it('computes load as (minutes) * (avgHr / maxHr)', () => {
		// 3600 sec = 60 min, avgHr=150, maxHr=200 => 60 * (150/200) = 60 * 0.75 = 45
		const result = estimateStravaLoad(3600, 150, 200);
		expect(result).toBeCloseTo(45, 5);
	});

	it('returns full minutes when avgHr equals maxHr', () => {
		// 1800 sec = 30 min, avgHr=maxHr => ratio = 1 => load = 30
		const result = estimateStravaLoad(1800, 180, 180);
		expect(result).toBeCloseTo(30, 5);
	});

	it('returns 0 for zero moving time', () => {
		expect(estimateStravaLoad(0, 150, 200)).toBe(0);
	});
});
