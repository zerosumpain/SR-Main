/**
 * Training Load (ACWR) Calculation Service
 *
 * Calculates Acute:Chronic Workload Ratio from Whoop cycle strain
 * and Strava activity data. Prefer Whoop strain when available,
 * falling back to an estimated load from Strava HR data.
 */

import { db } from '$lib/db';
import { whoopCycles, stravaActivities } from '$lib/db/schema';
import { and, gte, lte, desc } from 'drizzle-orm';
import type { TrainingLoadResponse } from './types';

// ==========================================
// Pure Functions
// ==========================================

/**
 * Calculate the Acute:Chronic Workload Ratio from a daily load history.
 *
 * - acute  = sum of last 7 days of load
 * - chronic = average daily load across all provided days * 7
 * - ratio  = acute / chronic
 *
 * Returns zeros for empty input.
 */
export function calculateACWR(
	history: Array<{ date: string; load: number }>
): { acute: number; chronic: number; ratio: number } {
	if (history.length === 0) {
		return { acute: 0, chronic: 0, ratio: 0 };
	}

	const totalLoad = history.reduce((sum, d) => sum + d.load, 0);

	// Acute = sum of last 7 days (or all if < 7)
	const acute = history.slice(-7).reduce((sum, d) => sum + d.load, 0);

	// Chronic = average daily load * 7 (weekly equivalent)
	const chronic = history.length > 0 ? (totalLoad / history.length) * 7 : 0;

	const ratio = chronic > 0 ? acute / chronic : 0;

	return { acute, chronic, ratio };
}

/**
 * Classify an ACWR ratio into a training load zone.
 */
export function classifyLoadZone(
	ratio: number
): 'detraining' | 'undertraining' | 'optimal' | 'caution' | 'danger' {
	if (ratio < 0.6) return 'detraining';
	if (ratio < 0.8) return 'undertraining';
	if (ratio <= 1.3) return 'optimal';
	if (ratio <= 1.5) return 'caution';
	return 'danger';
}

/**
 * Estimate a training load score from a Strava activity when no
 * Whoop cycle data is available.
 *
 * Formula: (movingTime in minutes) * (avgHr / maxHr)
 * Returns 0 if maxHr is 0 (no HR data).
 */
export function estimateStravaLoad(
	movingTimeSec: number,
	avgHr: number,
	maxHr: number
): number {
	if (!maxHr) return 0;
	return (movingTimeSec / 60) * (avgHr / maxHr);
}

// ==========================================
// Database Function
// ==========================================

/**
 * Get training load data for the health dashboard.
 *
 * 1. Query whoopCycles and stravaActivities for last 35 days
 * 2. Build a Map<date, load> -- prefer Whoop strain, fallback to Strava estimate
 * 3. Fill a 28-day array (today - 27 through today), defaulting missing days to 0
 * 4. Calculate ACWR
 * 5. Return TrainingLoadResponse
 */
export async function getTrainingLoad(): Promise<TrainingLoadResponse> {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	// 35 days back to have enough data for chronic calculation
	const lookbackMs = 35 * 24 * 60 * 60 * 1000;
	const startDate = new Date(today.getTime() - lookbackMs);
	const startUnix = Math.floor(startDate.getTime() / 1000);
	const endUnix = Math.floor(now.getTime() / 1000);

	// Query Whoop cycles and Strava activities in parallel
	const [cycles, activities] = await Promise.all([
		db
			.select()
			.from(whoopCycles)
			.where(and(gte(whoopCycles.startDate, startUnix), lte(whoopCycles.startDate, endUnix)))
			.orderBy(desc(whoopCycles.startDate)),
		db
			.select()
			.from(stravaActivities)
			.where(
				and(
					gte(stravaActivities.startDate, startUnix),
					lte(stravaActivities.startDate, endUnix)
				)
			)
			.orderBy(desc(stravaActivities.startDate)),
	]);

	// Build date -> load map
	const loadMap = new Map<string, number>();

	// Whoop cycles: use strain directly
	for (const cycle of cycles) {
		const dateKey = cycle.startDateLocal.slice(0, 10); // YYYY-MM-DD
		const strain = cycle.strain;
		// Accumulate in case of multiple cycles per day
		loadMap.set(dateKey, (loadMap.get(dateKey) ?? 0) + strain);
	}

	// Strava activities: only use if no Whoop data for that day
	for (const activity of activities) {
		const dateKey = activity.startDateLocal.slice(0, 10);
		if (!loadMap.has(dateKey)) {
			const load = estimateStravaLoad(
				activity.movingTime,
				activity.averageHeartrate ?? 0,
				activity.maxHeartrate ?? 0
			);
			loadMap.set(dateKey, (loadMap.get(dateKey) ?? 0) + load);
		}
	}

	// Build 28-day array (today - 27 through today)
	const history: Array<{ date: string; load: number }> = [];
	for (let i = 27; i >= 0; i--) {
		const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
		const dateKey = d.toISOString().slice(0, 10);
		history.push({
			date: dateKey,
			load: loadMap.get(dateKey) ?? 0,
		});
	}

	// Calculate ACWR
	const { acute, chronic, ratio } = calculateACWR(history);
	const zone = classifyLoadZone(ratio);

	return {
		acute,
		chronic,
		ratio,
		zone,
		history,
	};
}
