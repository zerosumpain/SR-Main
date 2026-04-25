import { db } from '$lib/db';
import { whoopRecovery } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeAutonomicBalance, type AutonomicSample } from '$lib/health/analytics/autonomic-balance';

export async function getAutonomicBalance() {
	const since = Math.floor(Date.now() / 1000) - 28 * 86400;
	const rows = await db
		.select({
			created: whoopRecovery.createdDate,
			hrv: whoopRecovery.hrvRmssd,
			rhr: whoopRecovery.restingHeartRate,
		})
		.from(whoopRecovery)
		.where(gte(whoopRecovery.createdDate, since))
		.orderBy(asc(whoopRecovery.createdDate));

	const series: AutonomicSample[] = rows.map((r) => ({
		date: new Date(r.created * 1000).toISOString().slice(0, 10),
		hrv: r.hrv,
		rhr: r.rhr,
	}));
	return computeAutonomicBalance(series);
}
