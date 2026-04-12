import { jsonCompletion } from '$lib/deepdive/ai';
import { db } from '$lib/db';
import { facts, entities, researchSessions, cdoPlans } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { KanbanPlan, KanbanCard, ThemeKey, PlanChangelog, ResearchFindings } from './types';
import { THEME_COLORS } from './types';

const VALID_THEMES = Object.keys(THEME_COLORS) as ThemeKey[];

/** Fuzzy-match a free-text theme string to the nearest valid ThemeKey */
function resolveTheme(raw: string): ThemeKey {
	const lower = raw.toLowerCase();
	// Direct match
	if (VALID_THEMES.includes(lower as ThemeKey)) return lower as ThemeKey;
	// Keyword matching
	const keywords: Record<ThemeKey, string[]> = {
		governance: ['governance', 'policy', 'standards', 'framework', 'strategy', 'regulation'],
		stakeholders: ['stakeholder', 'relationship', 'meeting', 'engagement', 'political', 'alignment'],
		platform: ['platform', 'architecture', 'infrastructure', 'system', 'technical', 'engineering', 'data asset', 'asset map'],
		compliance: ['compliance', 'gdpr', 'dpa', 'privacy', 'security', 'access', 'five safes'],
		culture: ['culture', 'literacy', 'training', 'change management', 'team', 'capability'],
		quickwins: ['quick win', 'quickwin', 'credibility', 'early', 'immediate'],
		risk: ['risk', 'crisis', 'mitigation', 'contingency'],
		insight: ['insight', 'analytics', 'dashboard', 'reporting', 'quality', 'data quality', 'discovery', 'mapping']
	};
	for (const [key, words] of Object.entries(keywords)) {
		if (words.some(w => lower.includes(w))) return key as ThemeKey;
	}
	return 'governance'; // fallback
}

/**
 * Normalize whatever the LLM returns into the strict KanbanPlan schema.
 * Handles: columns with id/order instead of week, cards with column ref instead of week,
 * themes as strings instead of objects, tags instead of stakeholders, etc.
 */
function normalizePlan(raw: Record<string, unknown>): KanbanPlan {
	const title = (raw.title as string) ?? '100-Day Plan: CDO at DfE';
	const summary = (raw.summary as string) ?? '';

	// --- Normalize columns ---
	const rawCols = (raw.columns as Array<Record<string, unknown>>) ?? [];
	const columns: { week: number; label: string; focus: string }[] = [];

	if (rawCols.length > 0 && 'week' in rawCols[0] && typeof rawCols[0].week === 'number') {
		// Already correct format
		for (const col of rawCols) {
			columns.push({
				week: col.week as number,
				label: (col.label as string) ?? `Week ${col.week}`,
				focus: (col.focus as string) ?? ''
			});
		}
	} else {
		// LLM used { id, order, title } or similar — map to weeks
		for (let i = 0; i < rawCols.length; i++) {
			const col = rawCols[i];
			columns.push({
				week: (col.order as number) ?? (col.week as number) ?? (i + 1),
				label: (col.label as string) ?? (col.title as string) ?? `Week ${i + 1}`,
				focus: (col.focus as string) ?? ''
			});
		}
	}
	// Deduplicate by week, sort
	const seenWeeks = new Set<number>();
	const uniqueCols = columns.filter(c => {
		if (seenWeeks.has(c.week)) return false;
		seenWeeks.add(c.week);
		return true;
	});
	uniqueCols.sort((a, b) => a.week - b.week);

	// Build column-id -> week map for cards referencing column IDs
	const colIdToWeek = new Map<string, number>();
	for (let i = 0; i < rawCols.length; i++) {
		const col = rawCols[i];
		if (col.id && typeof col.id === 'string') {
			colIdToWeek.set(col.id, (col.order as number) ?? (col.week as number) ?? (i + 1));
		}
	}

	// --- Normalize themes ---
	const rawThemes = raw.themes;
	const themes: { key: ThemeKey; label: string; description: string }[] = [];

	if (Array.isArray(rawThemes) && rawThemes.length > 0) {
		if (typeof rawThemes[0] === 'string') {
			// Themes are plain strings — map to theme objects
			for (const t of rawThemes as string[]) {
				const key = resolveTheme(t);
				if (!themes.find(th => th.key === key)) {
					themes.push({ key, label: t, description: '' });
				}
			}
		} else if (typeof rawThemes[0] === 'object') {
			for (const t of rawThemes as Array<Record<string, unknown>>) {
				const rawKey = (t.key as string) ?? '';
				const key = VALID_THEMES.includes(rawKey as ThemeKey) ? rawKey as ThemeKey : resolveTheme(rawKey || (t.label as string) || '');
				if (!themes.find(th => th.key === key)) {
					themes.push({
						key,
						label: (t.label as string) ?? rawKey,
						description: (t.description as string) ?? ''
					});
				}
			}
		}
	}
	// Ensure all 8 themes exist
	for (const key of VALID_THEMES) {
		if (!themes.find(t => t.key === key)) {
			themes.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1), description: '' });
		}
	}

	// --- Normalize cards ---
	const rawCards = (raw.cards as Array<Record<string, unknown>>) ?? [];
	const cards: KanbanCard[] = rawCards.map((c, i) => {
		// Resolve week: prefer numeric week, then column ref, then position
		let week: number;
		if (typeof c.week === 'number') {
			week = c.week;
		} else if (typeof c.column === 'string' && colIdToWeek.has(c.column)) {
			week = colIdToWeek.get(c.column)!;
		} else {
			week = 1;
		}

		// Resolve theme
		const rawTheme = (c.theme as string) ?? 'governance';
		const theme = VALID_THEMES.includes(rawTheme as ThemeKey) ? rawTheme as ThemeKey : resolveTheme(rawTheme);

		// Resolve priority
		const rawPriority = ((c.priority as string) ?? 'medium').toLowerCase();
		const priority = ['critical', 'high', 'medium', 'low'].includes(rawPriority)
			? rawPriority as KanbanCard['priority']
			: 'medium';

		// Resolve stakeholders from stakeholders or tags
		let stakeholders = (c.stakeholders as string[]) ?? [];
		if (stakeholders.length === 0 && Array.isArray(c.tags)) {
			// Tags often contain stakeholder names
			stakeholders = (c.tags as string[]).filter(t => {
				// Keep tags that look like names or roles (capitalized, or contain keywords)
				const lower = t.toLowerCase();
				return lower.includes('officer') || lower.includes('director') ||
					lower.includes('secretary') || lower.includes('minister') ||
					lower.includes('team') || lower.includes('unit') || lower.includes('department') ||
					/^[A-Z]/.test(t);
			});
		}

		return {
			id: (c.id as string) ?? `card-${Math.random().toString(36).slice(2, 9)}`,
			title: (c.title as string) ?? `Action ${i + 1}`,
			description: (c.description as string) ?? '',
			theme,
			week,
			priority,
			status: ((c.status as string) === 'done' || (c.status as string) === 'in_progress')
				? c.status as KanbanCard['status']
				: 'todo',
			stakeholders: stakeholders.length > 0 ? stakeholders : undefined,
			outcomes: (c.outcomes as string[]) ?? undefined,
			dependencies: (c.dependencies as string[]) ?? undefined
		};
	});

	return { title, summary, themes, columns: uniqueCols, cards };
}

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

		structure = normalizePlan(result.plan as unknown as Record<string, unknown>);
		changelog = result.changelog;
	} else {
		const result = await jsonCompletion<KanbanPlan>(
			SYNTHESIS_SYSTEM_PROMPT,
			JSON.stringify(findings, null, 2),
			{ maxTokens: 16384, temperature: 0.5 }
		);
		structure = normalizePlan(result as unknown as Record<string, unknown>);
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

const PARTIAL_SYNTHESIS_PROMPT = `You are a strategic advisor helping a newly appointed Chief Data Officer (CDO) at the UK Department for Education (DfE) plan their first 100 days (approximately 14 weeks).

This is a PARTIAL draft based on research-in-progress. Produce a lighter plan with 15-25 cards covering the most critical actions. Focus on the most important items you can identify from the available findings.

Available themes (use exactly these keys):
- "governance" — Data governance, policy, standards, frameworks
- "stakeholders" — Meeting people, relationship building, political navigation
- "platform" — Technical architecture, systems, data infrastructure
- "compliance" — GDPR, DPA 2018, regulation, security, privacy
- "culture" — Data literacy, training, change management, team building
- "quickwins" — Quick credibility-building actions
- "risk" — Risk identification, mitigation, crisis planning
- "insight" — Data quality, analytics, reporting, dashboards

Respond with valid JSON:
{
  "title": "100-Day Plan: CDO at DfE (Draft)",
  "summary": "Brief summary noting this is based on partial research",
  "themes": [
    { "key": "governance", "label": "Governance & Policy", "description": "..." }
  ],
  "columns": [
    { "week": 1, "label": "Week 1", "focus": "Listen & Learn" }
  ],
  "cards": [
    {
      "id": "unique-id",
      "title": "Short actionable title",
      "description": "What to do and why",
      "theme": "governance",
      "week": 1,
      "priority": "critical",
      "stakeholders": ["Specific person or role"],
      "outcomes": ["Measurable outcome"],
      "dependencies": []
    }
  ]
}`;

export async function synthesizePartialPlan(
	planId: string,
	sessionId: string
): Promise<void> {
	await db.update(cdoPlans).set({ status: 'synthesizing', updatedAt: new Date() }).where(eq(cdoPlans.id, planId));

	const findings = await gatherFindings(sessionId);

	let structure = await jsonCompletion<KanbanPlan>(
		PARTIAL_SYNTHESIS_PROMPT,
		JSON.stringify(findings, null, 2),
		{ maxTokens: 8192, temperature: 0.5 }
	);

	structure = normalizePlan(structure as unknown as Record<string, unknown>);

	await db
		.update(cdoPlans)
		.set({
			structure: structure as unknown as Record<string, unknown>,
			status: 'partial',
			updatedAt: new Date()
		})
		.where(eq(cdoPlans.id, planId));
}
