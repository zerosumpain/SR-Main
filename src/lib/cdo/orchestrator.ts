import { db } from '$lib/db';
import { researchSessions, cdoPlans, facts, entities, sources } from '$lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { startResearch, getEmitter } from '$lib/deepdive/worker';
import { synthesizePlan } from './synthesizer';
import { CDO_RESEARCH_TOPICS } from './topics';

// Track active CDO runs: planId -> sessionId
const activeCdoRuns = new Map<string, string>();

export function getActiveCdoRun(planId: string): string | undefined {
	return activeCdoRuns.get(planId);
}

/**
 * Get the current (latest) CDO plan, or null if none exists.
 */
export async function getCurrentPlan() {
	const [plan] = await db.select().from(cdoPlans).orderBy(desc(cdoPlans.createdAt)).limit(1);
	return plan ?? null;
}

/**
 * Get research activity across all CDO-related sessions.
 * Returns aggregate stats and per-run details.
 */
export async function getResearchActivity() {
	// Get all CDO plan records with their session info
	const cdoSessions = await db
		.select({
			sessionId: cdoPlans.sessionId,
			planId: cdoPlans.id,
			planStatus: cdoPlans.status,
			version: cdoPlans.version,
			createdAt: cdoPlans.createdAt
		})
		.from(cdoPlans)
		.orderBy(desc(cdoPlans.createdAt));

	let totalSources = 0;
	let totalFacts = 0;
	let totalEntities = 0;

	const runs = await Promise.all(
		cdoSessions.map(async (cdo) => {
			const [session] = await db
				.select({ topic: researchSessions.topic, status: researchSessions.status })
				.from(researchSessions)
				.where(eq(researchSessions.id, cdo.sessionId));

			const [fc] = await db
				.select({ count: sql<number>`count(*)` })
				.from(facts)
				.where(eq(facts.sessionId, cdo.sessionId));

			const [ec] = await db
				.select({ count: sql<number>`count(*)` })
				.from(entities)
				.where(eq(entities.sessionId, cdo.sessionId));

			const [sc] = await db
				.select({ count: sql<number>`count(*)` })
				.from(sources)
				.where(eq(sources.sessionId, cdo.sessionId));

			const factCount = Number(fc.count);
			const entityCount = Number(ec.count);
			const sourceCount = Number(sc.count);

			totalSources += sourceCount;
			totalFacts += factCount;
			totalEntities += entityCount;

			return {
				id: cdo.sessionId,
				planId: cdo.planId,
				topic: session?.topic ?? 'Unknown',
				status: session?.status ?? cdo.planStatus,
				createdAt: cdo.createdAt,
				factCount,
				entityCount,
				sourceCount
			};
		})
	);

	return { runs, totalSources, totalFacts, totalEntities };
}

/**
 * Start a new CDO research run.
 * Creates a Deep Dive session + a CDO plan record.
 * The synthesizer will see ALL previous research sessions and composite them.
 */
export async function startCdoResearch(): Promise<string> {
	// Get the current plan for compositing
	const previous = await getCurrentPlan();

	// Create the Deep Dive session with CDO-specific topics
	const [session] = await db
		.insert(researchSessions)
		.values({
			topic: CDO_RESEARCH_TOPICS.topic,
			goals: CDO_RESEARCH_TOPICS.goals,
			config: {
				maxSources: 40,
				diversityThreshold: 'high',
				analysisDepth: 'deep',
				redTeamAggression: 'standard',
				maxFactsBeforePhase3: 300
			},
			seedContext: {
				type: 'fact',
				parentTopic: CDO_RESEARCH_TOPICS.topic,
				parentGoals: CDO_RESEARCH_TOPICS.goals,
				suggestedQueries: CDO_RESEARCH_TOPICS.seedQueries
			}
		})
		.returning();

	// Create a new CDO plan record — composite, not a version
	const [plan] = await db
		.insert(cdoPlans)
		.values({
			sessionId: session.id,
			status: 'draft',
			previousPlanId: previous?.id ?? null
		})
		.returning();

	activeCdoRuns.set(plan.id, session.id);

	// Start research in background — don't await
	runCdoPipeline(plan.id, session.id, previous?.id).catch((err) => {
		console.error(`[cdo] Pipeline failed for plan ${plan.id}:`, err);
		db.update(cdoPlans)
			.set({ status: 'failed', updatedAt: new Date() })
			.where(eq(cdoPlans.id, plan.id));
	});

	return plan.id;
}

async function runCdoPipeline(
	planId: string,
	sessionId: string,
	previousPlanId?: string
): Promise<void> {
	await startResearch(sessionId);
	await waitForCompletion(sessionId);
	await synthesizePlan(planId, sessionId, previousPlanId);
	activeCdoRuns.delete(planId);
}

function waitForCompletion(sessionId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const interval = setInterval(async () => {
			try {
				const [session] = await db
					.select({ status: researchSessions.status })
					.from(researchSessions)
					.where(eq(researchSessions.id, sessionId));

				if (!session) {
					clearInterval(interval);
					reject(new Error('Session not found'));
					return;
				}

				if (session.status === 'complete') {
					clearInterval(interval);
					resolve();
				} else if (session.status === 'failed') {
					clearInterval(interval);
					reject(new Error('Research session failed'));
				}
			} catch (err) {
				clearInterval(interval);
				reject(err);
			}
		}, 3000);
	});
}

/**
 * Get the SSE event emitter for a CDO plan's research session.
 */
export function getCdoEventEmitter(planId: string) {
	const sessionId = activeCdoRuns.get(planId);
	if (!sessionId) return null;
	return { sessionId, emitter: getEmitter(sessionId) };
}
