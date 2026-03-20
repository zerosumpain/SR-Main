/**
 * Readiness Score Calculation Service
 *
 * Computes a daily readiness score from Whoop recovery, HRV trends,
 * sleep performance, and training load balance. Pure scoring functions
 * are exported for testing; the main getReadiness() function orchestrates
 * data fetching and composition.
 */

import { db } from '$lib/db';
import { whoopRecovery, whoopSleep } from '$lib/db/schema';
import { desc, eq, gte } from 'drizzle-orm';
import type { ReadinessResponse } from './types';
import { getTrainingLoad } from './training-load-service';

// ==========================================
// Pure Functions
// ==========================================

/**
 * Compute HRV trend factor from today's HRV versus a 7-day average.
 *
 * - Rising (>5% above avg): direction 'up', value 80-100
 * - Falling (<-5% below avg): direction 'down', value 0-40
 * - Stable (within +/-5%): direction 'stable', value 50-70
 */
export function normalizeHrvTrend(
	todayHrv: number,
	avg7d: number
): { value: number; direction: 'up' | 'down' | 'stable' } {
	if (!avg7d) return { value: 50, direction: 'stable' };

	const pctChange = ((todayHrv - avg7d) / avg7d) * 100;

	let value: number;
	let direction: 'up' | 'down' | 'stable';

	if (pctChange > 5) {
		direction = 'up';
		value = Math.min(100, 80 + (pctChange - 5) * 0.8);
	} else if (pctChange < -5) {
		direction = 'down';
		value = Math.max(0, 40 + (pctChange + 5) * 1.6);
	} else {
		direction = 'stable';
		value = 50 + (pctChange / 5) * 20;
	}

	return { value, direction };
}

/**
 * Score training load balance from ACWR ratio.
 *
 * 0.8-1.1 => 100 (optimal)
 * 1.1-1.3 => 80  (slightly high)
 * 1.3-1.5 => 50  (caution)
 * >1.5    => 20  (danger)
 * 0.6-0.8 => 60  (undertraining)
 * <0.6    => 30  (detraining)
 */
export function classifyLoadBalance(acwr: number): { value: number; zone: string } {
	if (acwr >= 0.8 && acwr <= 1.1) return { value: 100, zone: 'optimal' };
	if (acwr > 1.1 && acwr <= 1.3) return { value: 80, zone: 'slightly_high' };
	if (acwr > 1.3 && acwr <= 1.5) return { value: 50, zone: 'caution' };
	if (acwr > 1.5) return { value: 20, zone: 'danger' };
	if (acwr >= 0.6) return { value: 60, zone: 'undertraining' };
	return { value: 30, zone: 'detraining' };
}

/**
 * Compute the composite readiness score from weighted factors.
 *
 * Weights: recovery (0.4) + HRV trend (0.2) + sleep (0.2) + load balance (0.2)
 */
export function calculateReadinessScore(factors: {
	recovery: number;
	hrvTrend: number;
	sleepQuality: number;
	loadBalance: number;
}): number {
	return Math.round(
		factors.recovery * 0.4 +
			factors.hrvTrend * 0.2 +
			factors.sleepQuality * 0.2 +
			factors.loadBalance * 0.2
	);
}

/**
 * Map a numeric readiness score (0-100) to a human-readable label and recommendation.
 */
export function getReadinessLabel(score: number): { label: string; recommendation: string } {
	if (score >= 90)
		return {
			label: 'Peak Readiness',
			recommendation: 'Great day for a high-intensity session',
		};
	if (score >= 70)
		return { label: 'Ready to Push', recommendation: 'Solid day for training' };
	if (score >= 50)
		return { label: 'Moderate Day', recommendation: 'Easy or skill-focused work' };
	if (score >= 30)
		return { label: 'Recovery Priority', recommendation: 'Light movement only' };
	return { label: 'Rest Day', recommendation: 'Focus on sleep and nutrition' };
}

// ==========================================
// Database Function
// ==========================================

/**
 * Fetch all inputs and compute the full readiness response.
 *
 * 1. Parallel fetch: latest recovery, last 7 recoveries (for HRV avg),
 *    latest non-nap sleep, training load
 * 2. Compute composite score
 * 3. Assemble ReadinessResponse
 */
export async function getReadiness(): Promise<ReadinessResponse> {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const sevenDaysAgo = Math.floor(todayStart.getTime() / 1000) - 7 * 24 * 60 * 60;

	// Parallel data fetch
	const [latestRecoveryArr, recentRecoveries, latestSleepArr, trainingLoad] = await Promise.all([
		// Latest recovery
		db.select().from(whoopRecovery).orderBy(desc(whoopRecovery.createdDate)).limit(1),

		// Last 7 recoveries for HRV average
		db
			.select()
			.from(whoopRecovery)
			.where(gte(whoopRecovery.createdDate, sevenDaysAgo))
			.orderBy(desc(whoopRecovery.createdDate))
			.limit(7),

		// Latest non-nap sleep
		db
			.select()
			.from(whoopSleep)
			.where(eq(whoopSleep.nap, false))
			.orderBy(desc(whoopSleep.startDate))
			.limit(1),

		// Training load (ACWR)
		getTrainingLoad(),
	]);

	const latestRecovery = latestRecoveryArr[0] ?? null;
	const latestSleep = latestSleepArr[0] ?? null;

	// Calculate 7-day HRV average
	const hrvValues = recentRecoveries
		.map((r) => r.hrvRmssd)
		.filter((v): v is number => v != null);
	const hrv7DayAvg =
		hrvValues.length > 0 ? hrvValues.reduce((sum, v) => sum + v, 0) / hrvValues.length : null;

	// Compute individual factors
	const recoveryValue = latestRecovery?.recoveryScore ?? 50;

	const hrvTodayVal = latestRecovery?.hrvRmssd ?? null;
	const { value: hrvNormalized, direction: hrvDirection } =
		hrvTodayVal != null && hrv7DayAvg != null
			? normalizeHrvTrend(hrvTodayVal, hrv7DayAvg)
			: { value: 50, direction: 'stable' as const };

	const sleepValue = latestSleep?.sleepPerformance ?? 50;

	const { value: loadValue, zone: loadZone } = classifyLoadBalance(trainingLoad.ratio);

	// Composite score
	const score = calculateReadinessScore({
		recovery: recoveryValue,
		hrvTrend: hrvNormalized,
		sleepQuality: sleepValue,
		loadBalance: loadValue,
	});

	const { label, recommendation } = getReadinessLabel(score);

	return {
		score,
		label,
		recommendation,
		factors: {
			recovery: { value: recoveryValue, weight: 0.4 },
			hrvTrend: { value: hrvNormalized, weight: 0.2, direction: hrvDirection },
			sleepQuality: { value: sleepValue, weight: 0.2 },
			loadBalance: { value: loadValue, weight: 0.2, zone: loadZone },
		},
	};
}
