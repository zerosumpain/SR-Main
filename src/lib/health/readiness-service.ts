/**
 * Readiness Score Calculation Service
 *
 * Computes a daily readiness score from Whoop recovery, HRV trends,
 * sleep performance, and training load balance. Pure scoring functions
 * are exported for testing; the main getReadiness() function orchestrates
 * data fetching and composition.
 */

import { db } from '$lib/db';
import { appleHealthMetrics, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { ReadinessResponse } from './types';
import { getTrainingLoad } from './training-load-service';

const APPLE_SCALE = 100;

/** Collapse Apple's potentially many samples per local day before forming a
 * personal baseline. Otherwise a heavily sampled day silently gets more votes
 * than a lightly sampled one. */
export function summariseAppleMetric(
	rows: Array<{ date: number; dateLocal: string; value: number | null }>,
): { latest: number; averagePreviousDays: number | null; observedAt: string } | null {
	if (rows.length === 0) return null;
	const byDay = new Map<string, number[]>();
	const validRows: Array<{ date: number; dateLocal: string; value: number }> = [];
	for (const row of rows) {
		if (row.value == null) continue;
		validRows.push({ ...row, value: row.value });
		const value = row.value / APPLE_SCALE;
		if (!Number.isFinite(value)) continue;
		const day = /^\d{4}-\d{2}-\d{2}/.exec(row.dateLocal)?.[0]
			?? new Date(row.date * 1000).toISOString().slice(0, 10);
		const values = byDay.get(day) ?? [];
		values.push(value);
		byDay.set(day, values);
	}
	if (byDay.size === 0) return null;
	const days = [...byDay.entries()]
		.map(([day, values]) => ({ day, value: values.reduce((a, b) => a + b, 0) / values.length }))
		.sort((a, b) => a.day.localeCompare(b.day));
	const latestDay = days[days.length - 1];
	const previous = days.slice(Math.max(0, days.length - 8), -1);
	const newestRow = validRows.reduce((a, b) => (a.date > b.date ? a : b));
	return {
		latest: latestDay.value,
		averagePreviousDays: previous.length
			? previous.reduce((sum, d) => sum + d.value, 0) / previous.length
			: null,
		observedAt: new Date(newestRow.date * 1000).toISOString(),
	};
}

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
/**
 * The load leg of readiness: how much accumulated fatigue you are carrying.
 *
 * This used to score DETRAINING at 30 and undertraining at 60 — that is, it
 * penalised being rested. Readiness is meant to answer "how much can the body
 * take TODAY", and the answer when you have done very little lately is "quite a
 * lot": you are fresh. What being detrained costs you is FITNESS, which is the
 * VO₂max and efficiency story elsewhere on the page, not today's capacity.
 *
 * Getting this backwards had a visible consequence: a 94% recovery day with
 * good sleep and rising HRV came out at 66 — "Moderate Day" — purely because
 * the load leg scored 30 for being fresh, and the coach then proposed a two
 * kilometre walk on the best day in a fortnight.
 *
 * The high end still falls away, because carrying real fatigue genuinely does
 * reduce what you can take. `zone` keeps naming what is actually true so the
 * page can say "fresh — little accumulated fatigue" rather than implying the
 * base is where it should be.
 */
export function classifyLoadBalance(acwr: number): { value: number; zone: string } {
	if (acwr >= 0.8 && acwr <= 1.1) return { value: 100, zone: 'optimal' };
	if (acwr > 1.1 && acwr <= 1.3) return { value: 80, zone: 'slightly_high' };
	if (acwr > 1.3 && acwr <= 1.5) return { value: 50, zone: 'caution' };
	if (acwr > 1.5) return { value: 20, zone: 'danger' };
	// Below the optimal band you are carrying LESS fatigue, not more. Fresh, and
	// nearly as ready as the band where fitness is actually built.
	if (acwr >= 0.6) return { value: 90, zone: 'undertraining' };
	return { value: 85, zone: 'detraining' };
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
	const freshSince = Math.floor(now.getTime() / 1000) - 48 * 60 * 60;

	// Parallel data fetch
	const [latestRecoveryArr, recentRecoveries, latestSleepArr, appleRows, trainingLoad] = await Promise.all([
		// Latest recovery
		db.select().from(whoopRecovery)
			.where(gte(whoopRecovery.createdDate, freshSince))
			.orderBy(desc(whoopRecovery.createdDate)).limit(1),

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
			.where(and(eq(whoopSleep.nap, false), gte(whoopSleep.endDate, freshSince)))
			.orderBy(desc(whoopSleep.startDate))
			.limit(1),

		// HR/HRV comes from the Apple webhook for this owner. Whoop remains a
		// fallback so historical/self-hosted installations keep working.
		db
			.select({
				metricName: appleHealthMetrics.metricName,
				date: appleHealthMetrics.date,
				dateLocal: appleHealthMetrics.dateLocal,
				value: appleHealthMetrics.value,
			})
			.from(appleHealthMetrics)
			.where(and(
				gte(appleHealthMetrics.date, sevenDaysAgo - 24 * 60 * 60),
				inArray(appleHealthMetrics.metricName, ['heart_rate_variability', 'resting_heart_rate']),
			))
			.orderBy(desc(appleHealthMetrics.date)),

		// Training load (ACWR)
		getTrainingLoad(),
	]);

	const latestRecovery = latestRecoveryArr[0] ?? null;
	const latestSleep = latestSleepArr[0] ?? null;

	// Calculate 7-day HRV average
	const hrvValues = recentRecoveries
		.map((r) => r.hrvRmssd)
		.filter((v): v is number => v != null);
	const whoopHrv7DayAvg =
		hrvValues.length > 0 ? hrvValues.reduce((sum, v) => sum + v, 0) / hrvValues.length : null;
	const appleHrv = summariseAppleMetric(
		appleRows.filter((r) => r.metricName === 'heart_rate_variability'),
	);

	// Compute individual factors
	const recoveryValue = latestRecovery?.recoveryScore ?? 50;

	const hrvTodayVal = appleHrv?.latest ?? latestRecovery?.hrvRmssd ?? null;
	const hrv7DayAvg = appleHrv?.averagePreviousDays ?? whoopHrv7DayAvg;
	const hrvSource = appleHrv ? 'apple' as const : latestRecovery ? 'whoop' as const : undefined;
	const hrvObservedAt = appleHrv?.observedAt
		?? (latestRecovery ? new Date(latestRecovery.createdDate * 1000).toISOString() : undefined);
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
			hrvTrend: {
				value: hrvNormalized,
				weight: 0.2,
				direction: hrvDirection,
				raw: hrvTodayVal ?? undefined,
				avg7d: hrv7DayAvg ?? undefined,
				source: hrvSource,
				observedAt: hrvObservedAt,
			},
			sleepQuality: { value: sleepValue, weight: 0.2 },
			loadBalance: { value: loadValue, weight: 0.2, zone: loadZone },
		},
	};
}
