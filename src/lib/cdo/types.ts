/** Recursive plan section — structure is emergent, determined by the LLM */
export interface PlanSection {
	title: string;
	type: string; // 'section' | 'task' | 'milestone' | 'note' | 'kpi' | whatever the LLM decides
	content?: string;
	children?: PlanSection[];
	metadata?: Record<string, unknown>; // e.g. deadline, priority, owner, status
}

/** Top-level plan structure stored in cdo_plans.structure */
export interface PlanStructure {
	title: string;
	summary: string;
	sections: PlanSection[];
}

/** Changelog produced on re-runs */
export interface PlanChangelog {
	added: string[];
	modified: string[];
	removed: string[];
	reasoning: string;
}

/** Synthesis input: research findings fed to the LLM */
export interface ResearchFindings {
	facts: { content: string; confidence: number; tags: string[] }[];
	entities: { name: string; type: string; description: string | null }[];
	gaps: { gap: string; severity: string }[];
	clusters: { title: string; summary: string }[];
	summary: string;
}

/** Status of a CDO research run */
export type CdoPlanStatus = 'draft' | 'synthesizing' | 'complete' | 'failed';
