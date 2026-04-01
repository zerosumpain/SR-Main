import { db } from '$lib/db';
import { researchSessions, cdoPlans } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
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
 * Get all plan versions ordered by version desc.
 */
export async function getPlanHistory() {
	return db.select().from(cdoPlans).orderBy(desc(cdoPlans.version));
}

/**
 * Start a new CDO research run.
 * Creates a Deep Dive session + a CDO plan record, then kicks off research.
 * When research completes, synthesis begins automatically.
 */
export async function startCdoResearch(previousPlanId?: string): Promise<string> {
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

	// Create the CDO plan record
	const [plan] = await db
		.insert(cdoPlans)
		.values({
			sessionId: session.id,
			status: 'draft'
		})
		.returning();

	activeCdoRuns.set(plan.id, session.id);

	// Start research in background — don't await
	runCdoPipeline(plan.id, session.id, previousPlanId).catch((err) => {
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
	// Start the Deep Dive research (runs in background within startResearch)
	await startResearch(sessionId);

	// Poll until research is complete
	await waitForCompletion(sessionId);

	// Run synthesis — reads research findings and produces the plan
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
