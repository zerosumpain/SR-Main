import { jsonCompletion } from '$lib/deepdive/ai';
import { db } from '$lib/db';
import { facts, entities, researchSessions, cdoPlans } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { KanbanPlan, PlanChangelog, ResearchFindings } from './types';

const SYNTHESIS_SYSTEM_PROMPT = `You are a strategic advisor helping a newly appointed Chief Data Officer (CDO) at the UK Department for Education (DfE) plan their first 100 days (approximately 14 weeks).

You will receive research findings about recent DfE policies, active strategies, confirmed stakeholders, and the education data landscape.

CRITICAL: Base every recommendation on SPECIFIC, RECENT findings from the research. Do not make generic assumptions. If the research mentions a specific person, policy, or programme, use it. If it doesn't mention something, don't invent it.

Your task: produce a kanban-style action plan organised by WEEK with cards coloured by THEME.

Available themes (use exactly these keys):
- "governance" — Data governance, policy, standards, frameworks
- "stakeholders" — Meeting people, relationship building, political navigation
- "platform" — Technical architecture, systems, data infrastructure
- "compliance" — GDPR, DPA 2018, regulation, security, privacy
- "culture" — Data literacy, training, change management, team building
- "quickwins" — Quick credibility-building actions
- "risk" — Risk identification, mitigation, crisis planning
- "insight" — Data quality, analytics, reporting, dashboards

Produce 30-50 cards spread across 14 weeks. Each card must be SPECIFIC and ACTIONABLE.

Respond with valid JSON:
{
  "title": "100-Day Plan: CDO at DfE",
  "summary": "2-3 paragraph executive summary referencing specific findings",
  "themes": [
    { "key": "governance", "label": "Governance & Policy", "description": "..." },
    { "key": "stakeholders", "label": "Stakeholders", "description": "..." }
  ],
  "columns": [
    { "week": 1, "label": "Week 1", "focus": "Listen & Learn" },
    { "week": 2, "label": "Week 2", "focus": "..." }
  ],
  "cards": [
    {
      "id": "unique-id",
      "title": "Short actionable title",
      "description": "What to do, why, and expected outcome (2-3 sentences)",
      "theme": "governance",
      "week": 1,
      "priority": "critical",
      "stakeholders": ["Specific person or role from research"],
      "outcomes": ["Measurable outcome"],
      "dependencies": ["id of card this depends on"]
    }
  ]
}`;

const RE_SYNTHESIS_SYSTEM_PROMPT = `You are updating a kanban-style 100-day plan for a CDO at the UK Department for Education.

You will receive:
1. The PREVIOUS plan (kanban format)
2. NEW research findings since the last run

CRITICAL: Only add or modify cards based on NEW, SPECIFIC findings. Do not fabricate stakeholders or policies not in the research.

Update the plan, then provide a changelog.

Respond with valid JSON:
{
  "plan": { "title": "...", "summary": "...", "themes": [...], "columns": [...], "cards": [...] },
  "changelog": {
    "added": ["description"],
    "modified": ["description"],
    "removed": ["description"],
    "reasoning": "Why"
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
	await db.update(cdoPlans).set({ status: 'synthesizing', updatedAt: new Date() }).where(eq(cdoPlans.id, planId));

	const findings = await gatherFindings(sessionId);

	let structure: KanbanPlan;
	let changelog: PlanChangelog | undefined;

	if (previousPlanId) {
		const [prev] = await db
			.select({ structure: cdoPlans.structure })
			.from(cdoPlans)
			.where(eq(cdoPlans.id, previousPlanId));
		const prevPlan = prev?.structure as KanbanPlan | null;

		const result = await jsonCompletion<{
			plan: KanbanPlan;
			changelog: PlanChangelog;
		}>(
			RE_SYNTHESIS_SYSTEM_PROMPT,
			JSON.stringify({ previousPlan: prevPlan, newFindings: findings }, null, 2),
			{ maxTokens: 16384, temperature: 0.4 }
		);

		structure = result.plan;
		changelog = result.changelog;
	} else {
		const result = await jsonCompletion<KanbanPlan>(
			SYNTHESIS_SYSTEM_PROMPT,
			JSON.stringify(findings, null, 2),
			{ maxTokens: 16384, temperature: 0.5 }
		);
		structure = result;
	}

	// Assign status defaults
	for (const card of structure.cards) {
		if (!card.status) card.status = 'todo';
		if (!card.id) card.id = `card-${Math.random().toString(36).slice(2, 9)}`;
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
