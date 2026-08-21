import { describe, it, expect } from 'vitest';
import {
	normalizeHrvTrend,
	classifyLoadBalance,
	calculateReadinessScore,
	getReadinessLabel,
} from '$lib/health/readiness-service';

describe('normalizeHrvTrend', () => {
	it('returns stable at 50 when avg7d is 0', () => {
		const result = normalizeHrvTrend(60, 0);
		expect(result.value).toBe(50);
		expect(result.direction).toBe('stable');
	});

	it('returns stable direction when pctChange is within +/-5%', () => {
		// 0% change
		const result = normalizeHrvTrend(60, 60);
		expect(result.direction).toBe('stable');
		expect(result.value).toBeGreaterThanOrEqual(50);
		expect(result.value).toBeLessThanOrEqual(70);
	});

	it('returns up direction when pctChange > 5%', () => {
		// +10% change: (66 - 60) / 60 * 100 = 10%
		const result = normalizeHrvTrend(66, 60);
		expect(result.direction).toBe('up');
		expect(result.value).toBeGreaterThanOrEqual(80);
		expect(result.value).toBeLessThanOrEqual(100);
	});

	it('returns down direction when pctChange < -5%', () => {
		// -10% change: (54 - 60) / 60 * 100 = -10%
		const result = normalizeHrvTrend(54, 60);
		expect(result.direction).toBe('down');
		expect(result.value).toBeGreaterThanOrEqual(0);
		expect(result.value).toBeLessThan(40);
	});

	it('caps value at 100 for very large HRV increase', () => {
		const result = normalizeHrvTrend(120, 60); // +100%
		expect(result.value).toBe(100);
		expect(result.direction).toBe('up');
	});

	it('caps value at 0 for very large HRV decrease', () => {
		const result = normalizeHrvTrend(30, 60); // -50%
		expect(result.value).toBe(0);
		expect(result.direction).toBe('down');
	});

	it('returns value ~70 at exactly +5% boundary', () => {
		// pctChange = 5% => stable zone, value = 50 + (5/5)*20 = 70
		const result = normalizeHrvTrend(63, 60);
		expect(result.direction).toBe('stable');
		expect(result.value).toBeCloseTo(70, 0);
	});

	it('returns value ~50 at exactly -5% boundary', () => {
		// pctChange = -5% => stable zone, value = 50 + (-5/5)*20 = 30... wait
		// Actually at -5%: value = 50 + (-5/5)*20 = 50 - 20 = 30
		// But -5% is the boundary, pctChange < -5 is false, so still stable
		const result = normalizeHrvTrend(57, 60);
		// pctChange = (57-60)/60*100 = -5%
		expect(result.direction).toBe('stable');
	});
});

describe('classifyLoadBalance', () => {
	it('returns optimal zone for ACWR 0.8-1.1', () => {
		expect(classifyLoadBalance(0.8)).toEqual({ value: 100, zone: 'optimal' });
		expect(classifyLoadBalance(1.0)).toEqual({ value: 100, zone: 'optimal' });
		expect(classifyLoadBalance(1.1)).toEqual({ value: 100, zone: 'optimal' });
	});

	it('returns slightly_high zone for ACWR 1.1-1.3', () => {
		const result = classifyLoadBalance(1.2);
		expect(result).toEqual({ value: 80, zone: 'slightly_high' });
	});

	it('returns caution zone for ACWR 1.3-1.5', () => {
		const result = classifyLoadBalance(1.4);
		expect(result).toEqual({ value: 50, zone: 'caution' });
	});

	it('returns danger zone for ACWR > 1.5', () => {
		const result = classifyLoadBalance(1.8);
		expect(result).toEqual({ value: 20, zone: 'danger' });
	});

	// Below the optimal band you are carrying LESS fatigue, not more. This leg
	// answers "how much can the body take today", and the answer when you have
	// done very little lately is "quite a lot". It used to score 60 and 30, so a
	// rested body read as an unready one — which put a 94% recovery day at a
	// composite of 66 and had the coach propose a 2 km walk on it.
	it('treats being undertrained as FRESH, not as unready', () => {
		const result = classifyLoadBalance(0.7);
		expect(result.zone).toBe('undertraining');
		expect(result.value).toBeGreaterThanOrEqual(80);
	});

	it('treats being detrained as fresh too, while still naming the base honestly', () => {
		const result = classifyLoadBalance(0.3);
		expect(result.zone).toBe('detraining');
		expect(result.value).toBeGreaterThanOrEqual(80);
	});

	it('still falls away as real fatigue accumulates', () => {
		const carrying = [1.2, 1.4, 1.8].map((r) => classifyLoadBalance(r).value);
		expect(carrying).toEqual([...carrying].sort((a, b) => b - a));
		expect(classifyLoadBalance(1.8).value).toBeLessThan(classifyLoadBalance(0.3).value);
	});

	it('handles a zero ratio without special-casing it', () => {
		const result = classifyLoadBalance(0);
		expect(result.zone).toBe('detraining');
		expect(result.value).toBeGreaterThanOrEqual(80);
	});

	it('lets a genuinely good day read as one', () => {
		// The failure this exists for: 94% recovered, HRV up, slept well, fresh —
		// and the composite came out at 66, "Moderate Day".
		const score = calculateReadinessScore({
			recovery: 94,
			hrvTrend: 88,
			sleepQuality: 80,
			loadBalance: classifyLoadBalance(0.3).value,
		});
		expect(score).toBeGreaterThanOrEqual(85);
		expect(getReadinessLabel(score).label).toMatch(/Ready to Push|Peak Readiness/);
	});
});

describe('calculateReadinessScore', () => {
	it('computes weighted average correctly', () => {
		const score = calculateReadinessScore({
			recovery: 80,
			hrvTrend: 60,
			sleepQuality: 70,
			loadBalance: 100,
		});
		// 80*0.4 + 60*0.2 + 70*0.2 + 100*0.2
		// = 32 + 12 + 14 + 20 = 78
		expect(score).toBe(78);
	});

	it('returns 100 when all factors are 100', () => {
		const score = calculateReadinessScore({
			recovery: 100,
			hrvTrend: 100,
			sleepQuality: 100,
			loadBalance: 100,
		});
		expect(score).toBe(100);
	});

	it('returns 0 when all factors are 0', () => {
		const score = calculateReadinessScore({
			recovery: 0,
			hrvTrend: 0,
			sleepQuality: 0,
			loadBalance: 0,
		});
		expect(score).toBe(0);
	});

	it('rounds to nearest integer', () => {
		// 85*0.4 + 55*0.2 + 65*0.2 + 95*0.2
		// = 34 + 11 + 13 + 19 = 77
		const score = calculateReadinessScore({
			recovery: 85,
			hrvTrend: 55,
			sleepQuality: 65,
			loadBalance: 95,
		});
		expect(Number.isInteger(score)).toBe(true);
	});
});

describe('getReadinessLabel', () => {
	it('returns Peak Readiness for score >= 90', () => {
		const result = getReadinessLabel(90);
		expect(result.label).toBe('Peak Readiness');
		expect(result.recommendation).toBeTruthy();
	});

	it('returns Peak Readiness for score = 100', () => {
		const result = getReadinessLabel(100);
		expect(result.label).toBe('Peak Readiness');
	});

	it('returns Ready to Push for score >= 70 and < 90', () => {
		expect(getReadinessLabel(70).label).toBe('Ready to Push');
		expect(getReadinessLabel(89).label).toBe('Ready to Push');
	});

	it('returns Moderate Day for score >= 50 and < 70', () => {
		expect(getReadinessLabel(50).label).toBe('Moderate Day');
		expect(getReadinessLabel(69).label).toBe('Moderate Day');
	});

	it('returns Recovery Priority for score >= 30 and < 50', () => {
		expect(getReadinessLabel(30).label).toBe('Recovery Priority');
		expect(getReadinessLabel(49).label).toBe('Recovery Priority');
	});

	it('returns Rest Day for score < 30', () => {
		expect(getReadinessLabel(0).label).toBe('Rest Day');
		expect(getReadinessLabel(29).label).toBe('Rest Day');
	});

	it('includes a non-empty recommendation for all labels', () => {
		[0, 30, 50, 70, 90].forEach((score) => {
			const { recommendation } = getReadinessLabel(score);
			expect(recommendation.length).toBeGreaterThan(0);
		});
	});
});
