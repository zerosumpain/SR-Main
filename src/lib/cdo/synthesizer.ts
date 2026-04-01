import { jsonCompletion } from '$lib/deepdive/ai';
import { db } from '$lib/db';
import { facts, entities, researchSessions, cdoPlans } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { PlanStructure, PlanChangelog, ResearchFindings } from './types';

const SYNTHESIS_SYSTEM_PROMPT = `You are a strategic advisor helping a newly appointed Chief Data Officer (CDO) at the UK Department for Education (DfE) plan their first 100 days.

You will receive research findings from an extensive multi-source research process covering web articles, academic papers, policy documents, and case studies about the CDO role in UK government and the education sector.

Your task: produce a comprehensive, actionable 100-day plan. You decide the structure — use whatever organisation best serves the material. Common approaches include phases (30-60-90), thematic pillars, or week-by-week breakdowns, but you should choose what fits best.

Each item must be actionable with clear outcomes. Include:
- Key stakeholders to engage
- Quick wins to build credibility
- Strategic foundations to lay
- Risks to watch for
- Metrics for success

Respond with valid JSON matching this structure:
{
  "title": "...",
  "summary": "Executive summary (2-3 paragraphs)",
  "sections": [
    {
      "title": "Section title",
      "type": "section",
      "content": "Optional overview text",
      "children": [
        {
          "title": "Item title",
          "type": "task|milestone|note|kpi|section",
          "content": "Description",
          "metadata": { "deadline": "...", "priority": "high|medium|low", "owner": "..." },
          "children": []
        }
      ]
    }
  ]
}`;

const RE_SYNTHESIS_SYSTEM_PROMPT = `You are a strategic advisor updating a 100-day plan for a CDO at the UK Department for Education.

You will receive:
1. The PREVIOUS plan
2. NEW research findings since the last run

Your task: update the plan based on new information. You may restructure, add, remove, or modify sections. After the updated plan, include a changelog.

Respond with valid JSON:
{
  "plan": { "title": "...", "summary": "...", "sections": [...] },
  "changelog": {
    "added": ["description of added items"],
    "modified": ["description of modified items"],
    "removed": ["description of removed items"],
    "reasoning": "Why these changes were made"
  }
}`;

async function gatherFindings(sessionId: string): Promise<ResearchFindings> {
	const factRows = await db
		.select({ content: facts.content, confidence: facts.confidence, tags: facts.tags })
		.from(facts)
		.where(eq(facts.sessionId, sessionId))
		.orderBy(desc(facts.confidence))
		.limit(100);

	const entityRows = await db
		.select({ name: entities.name, type: entities.type, description: entities.description })
		.from(entities)
		.where(eq(entities.sessionId, sessionId))
		.limit(50);

	const [session] = await db
		.select({ report: researchSessions.report })
		.from(researchSessions)
		.where(eq(researchSessions.id, sessionId));

	const report = session?.report as Record<string, unknown> | null;

	return {
		facts: factRows.map((f) => ({
			content: f.content,
			confidence: Number(f.confidence),
			tags: (f.tags as string[]) ?? []
		})),
		entities: entityRows,
		gaps:
			((report?.knowledge_gaps as Array<{ gap: string; severity: string }>) ?? []).map((g) => ({
				gap: g.gap,
				severity: g.severity
			})),
		clusters:
			((report?.clusters as Array<{ title: string; summary: string }>) ?? []).map((c) => ({
				title: c.title,
				summary: c.summary
			})),
		summary: (report?.executive_summary as string) ?? ''
	};
}

export async function synthesizePlan(
	planId: string,
	sessionId: string,
	previousPlanId?: string
): Promise<void> {
	// Update status to synthesizing
	await db.update(cdoPlans).set({ status: 'synthesizing', updatedAt: new Date() }).where(eq(cdoPlans.id, planId));

	const findings = await gatherFindings(sessionId);

	let structure: PlanStructure;
	let changelog: PlanChangelog | undefined;

	if (previousPlanId) {
		const [prev] = await db
			.select({ structure: cdoPlans.structure })
			.from(cdoPlans)
			.where(eq(cdoPlans.id, previousPlanId));
		const prevPlan = prev?.structure as PlanStructure | null;

		const result = await jsonCompletion<{
			plan: PlanStructure;
			changelog: PlanChangelog;
		}>(
			RE_SYNTHESIS_SYSTEM_PROMPT,
			JSON.stringify({ previousPlan: prevPlan, newFindings: findings }, null, 2),
			{ maxTokens: 8192, temperature: 0.4 }
		);

		structure = result.plan;
		changelog = result.changelog;
	} else {
		const result = await jsonCompletion<PlanStructure>(
			SYNTHESIS_SYSTEM_PROMPT,
			JSON.stringify(findings, null, 2),
			{ maxTokens: 8192, temperature: 0.5 }
		);
		structure = result;
	}

	// Determine version
	let version = 1;
	if (previousPlanId) {
		const [prev] = await db
			.select({ version: cdoPlans.version })
			.from(cdoPlans)
			.where(eq(cdoPlans.id, previousPlanId));
		version = (prev?.version ?? 0) + 1;
	}

	// Update the plan record
	await db
		.update(cdoPlans)
		.set({
			structure: structure as unknown as Record<string, unknown>,
			changelog: changelog as unknown as Record<string, unknown> | null,
			version,
			previousPlanId: previousPlanId ?? null,
			status: 'complete',
			updatedAt: new Date()
		})
		.where(eq(cdoPlans.id, planId));
}
