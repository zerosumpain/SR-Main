// src/lib/canvas/intelligence/desk/report-view.ts
// Pure assembly of the ResearchReport jsonb + the desk's flat card list into a
// render-ready view-model for ReportNode.svelte. No Svelte, no DOM — unit-tested.
import { severityColor } from '$lib/deepdive/display';
import type {
  ResearchReport,
  KnowledgeGap,
  Hypothesis,
  FollowUpSuggestion,
  SourceDiversity,
} from '$lib/deepdive/types';

/** The minimal slice of a desk card this module needs (kind + fields). */
export interface DeskCardLite {
  id: string;
  kind: 'source' | 'fact' | 'entity';
  fields: Record<string, unknown>;
}

export interface FactRef {
  id: string;
  content: string;
}

export interface ClusterView {
  title: string;
  summary: string;
  /** Total fact_ids in the cluster (incl. ids with no matching card). */
  factCount: number;
  /** Resolved facts (ids with a matching fact card, order-preserved). */
  facts: FactRef[];
}

export interface GapView {
  gap: string;
  type: KnowledgeGap['type'];
  severity: KnowledgeGap['severity'];
  color: string;
}

export interface HypothesisView {
  hypothesis: string;
  testability: Hypothesis['testability'];
  supporting: FactRef[];
  tension: FactRef[];
  suggestedQueries: string[];
}

export interface FollowupView {
  question: string;
  context: string;
  seedFacts: FactRef[];
}

export interface EntityView {
  id: string;
  name: string;
  type: string;
  centrality: number;
}

export interface ReportView {
  hasReport: boolean;
  executiveSummary: string;
  clusters: ClusterView[];
  knowledgeGaps: GapView[];
  hypotheses: HypothesisView[];
  followups: FollowupView[];
  topEntities: EntityView[];
  sourceDiversity: SourceDiversity | null;
}

const EMPTY: ReportView = {
  hasReport: false,
  executiveSummary: '',
  clusters: [],
  knowledgeGaps: [],
  hypotheses: [],
  followups: [],
  topEntities: [],
  sourceDiversity: null,
};

export interface BuildReportViewOpts {
  /** Max entities shown in the "key players" strip (default 12). */
  entityLimit?: number;
}

export function buildReportView(
  report: ResearchReport | null | undefined,
  cards: ReadonlyArray<DeskCardLite>,
  opts: BuildReportViewOpts = {},
): ReportView {
  if (!report) return { ...EMPTY };
  const hasContent =
    (typeof report.executive_summary === 'string' && report.executive_summary.length > 0) ||
    (Array.isArray(report.clusters) && report.clusters.length > 0);
  if (!hasContent) return { ...EMPTY };

  const entityLimit = opts.entityLimit ?? 12;

  // Index fact content + entity meta by id for O(1) joins.
  const factContent = new Map<string, string>();
  const entityMeta = new Map<string, { name: string; type: string }>();
  for (const c of cards) {
    if (c.kind === 'fact') {
      factContent.set(c.id, String(c.fields.content ?? ''));
    } else if (c.kind === 'entity') {
      entityMeta.set(c.id, {
        name: String(c.fields.name ?? c.id),
        type: String(c.fields.type ?? 'other'),
      });
    }
  }

  const resolveFacts = (ids: string[] | undefined): FactRef[] => {
    if (!Array.isArray(ids)) return [];
    const out: FactRef[] = [];
    for (const id of ids) {
      const content = factContent.get(id);
      if (content != null) out.push({ id, content });
    }
    return out;
  };

  const clusters: ClusterView[] = (report.clusters ?? []).map((cl) => ({
    title: cl.title ?? '',
    summary: cl.summary ?? '',
    factCount: Array.isArray(cl.fact_ids) ? cl.fact_ids.length : 0,
    facts: resolveFacts(cl.fact_ids),
  }));

  const knowledgeGaps: GapView[] = (report.knowledge_gaps ?? []).map((g: KnowledgeGap) => ({
    gap: g.gap,
    type: g.type,
    severity: g.severity,
    color: severityColor(g.severity),
  }));

  const hypotheses: HypothesisView[] = (report.hypotheses ?? []).map((h: Hypothesis) => ({
    hypothesis: h.hypothesis,
    testability: h.testability,
    supporting: resolveFacts(h.supporting_fact_ids),
    tension: resolveFacts(h.tension_fact_ids),
    suggestedQueries: Array.isArray(h.suggested_queries) ? h.suggested_queries : [],
  }));

  const followups: FollowupView[] = (report.suggested_followups ?? []).map((f: FollowUpSuggestion) => ({
    question: f.question,
    context: f.context,
    seedFacts: resolveFacts(f.seed_fact_ids),
  }));

  const topEntities: EntityView[] = Object.entries(report.entity_centrality ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, entityLimit)
    .map(([id, centrality]) => {
      const meta = entityMeta.get(id);
      return {
        id,
        name: meta?.name ?? id,
        type: meta?.type ?? 'other',
        centrality,
      };
    });

  return {
    hasReport: true,
    executiveSummary: report.executive_summary ?? '',
    clusters,
    knowledgeGaps,
    hypotheses,
    followups,
    topEntities,
    sourceDiversity: report.source_diversity ?? null,
  };
}
