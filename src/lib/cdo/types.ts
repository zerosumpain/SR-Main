/** Theme colours for the kanban board */
export const THEME_COLORS: Record<string, { bg: string; border: string; text: string; light: string }> = {
	governance: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd', light: '#1e3a5f' },
	stakeholders: { bg: '#3b1f2b', border: '#ec4899', text: '#f9a8d4', light: '#4a1d35' },
	platform: { bg: '#1a3c34', border: '#10b981', text: '#6ee7b7', light: '#1a3c34' },
	compliance: { bg: '#3b2f1a', border: '#f59e0b', text: '#fcd34d', light: '#3b2f1a' },
	culture: { bg: '#2d1f3b', border: '#8b5cf6', text: '#c4b5fd', light: '#2d1f3b' },
	quickwins: { bg: '#1a3b2f', border: '#34d399', text: '#a7f3d0', light: '#1a3b2f' },
	risk: { bg: '#3b1a1a', border: '#ef4444', text: '#fca5a5', light: '#3b1a1a' },
	insight: { bg: '#1a2f3b', border: '#06b6d4', text: '#67e8f9', light: '#1a2f3b' }
};

export type ThemeKey = keyof typeof THEME_COLORS;

/** A single kanban card */
export interface KanbanCard {
	id: string;
	title: string;
	description: string;
	theme: ThemeKey;
	week: number; // 1-14
	priority: 'critical' | 'high' | 'medium' | 'low';
	status: 'todo' | 'in_progress' | 'done';
	stakeholders?: string[];
	outcomes?: string[];
	dependencies?: string[];
}

/** The full kanban plan */
export interface KanbanPlan {
	title: string;
	summary: string;
	themes: { key: ThemeKey; label: string; description: string }[];
	columns: { week: number; label: string; focus: string }[];
	cards: KanbanCard[];
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
export type CdoPlanStatus = 'draft' | 'synthesizing' | 'partial' | 'complete' | 'failed';
