// src/lib/deepdive/chat-context.ts
// Pure, network-free context assembly for POST /api/deepdive/[id]/chat.
// All DB / embedding / SQL work happens in the endpoint; this module only
// shapes already-fetched data into the system + user prompts and the citation
// list. Kept pure so it is fully unit-testable.
import type { ResearchReport } from './types';

/** Each retrieved fact carries enough to cite its source and rank it. */
export interface RetrievedFact {
  id: string;
  content: string;
  sourceId: string;
  similarity: number;
}

/** Resolved source metadata for [n] citations. */
export interface SourceMeta {
  id: string;
  title: string | null;
  domain: string | null;
  url: string | null;
}

/** A citation entry surfaced to the client in the `sources` SSE frame. */
export interface CitationSource {
  n: number;
  title: string | null;
  domain: string | null;
  url: string | null;
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface OverviewFact {
  id: string;
  content: string;
  confidence: number;
}

interface OverviewEntity {
  id: string;
  name: string;
  type: string;
}

// Tunables (also asserted by the tests so they stay honest).
export const PASSAGE_CAP = 1400;
export const MAX_HISTORY_TURNS = 6;
const MAX_OVERVIEW_FACTS = 8;
const MAX_OVERVIEW_CLUSTERS = 8;
const MAX_OVERVIEW_ENTITIES = 8;
const MAX_FALLBACK_FACTS = 10;

export const CHAT_SYSTEM = `You are the research assistant for a single Research Desk session. You answer ONLY from the CONTEXT supplied below — the session overview and the retrieved fact passages.

RULES:
1. Ground every factual claim in the OVERVIEW or the PASSAGES below. Do not use outside knowledge to assert facts. If the context does not cover the question, say so plainly ("this session's research doesn't cover that") rather than inventing an answer.
2. Cite the passages you use with their [n] markers inline (the numbers map to the sources listed for this session).
3. Be concise, neutral and precise. Distinguish what the research firmly establishes from what is uncertain or contested. Never overstate certainty.
4. Stay scoped to THIS session's topic and research. Politely decline unrelated requests in one sentence.
Never fabricate statistics, sources or quotes.`;

/**
 * Compact, pre-ranked overview drawn from the persisted ResearchReport:
 * executive summary + top ranked facts + cluster titles/summaries + top
 * entities by centrality. When the report is null/empty, fall back to the
 * highest-confidence facts supplied by the caller.
 */
export function buildOverview(
  report: ResearchReport | null,
  factsById: Map<string, OverviewFact>,
  entitiesById: Map<string, OverviewEntity>,
  fallbackFacts: OverviewFact[] = [],
): string {
  const lines: string[] = [];

  if (report && (report.executive_summary || report.ranked_facts?.length)) {
    if (report.executive_summary) {
      lines.push('SESSION SUMMARY:');
      lines.push(report.executive_summary.trim());
    }

    const ranked = (report.ranked_facts ?? []).slice(0, MAX_OVERVIEW_FACTS);
    const rankedLines = ranked
      .map((fid) => factsById.get(fid))
      .filter((f): f is OverviewFact => !!f)
      .map((f) => `  • ${f.content}`);
    if (rankedLines.length) {
      lines.push('', 'TOP-RANKED FACTS:', ...rankedLines);
    }

    const clusters = (report.clusters ?? []).slice(0, MAX_OVERVIEW_CLUSTERS);
    if (clusters.length) {
      lines.push('', 'THEMES (clusters):');
      for (const c of clusters) {
        lines.push(`  • ${c.title}${c.summary ? ` — ${c.summary}` : ''}`);
      }
    }

    const centrality = report.entity_centrality ?? {};
    const topEntities = Object.entries(centrality)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_OVERVIEW_ENTITIES)
      .map(([eid]) => entitiesById.get(eid))
      .filter((e): e is OverviewEntity => !!e);
    if (topEntities.length) {
      lines.push('', 'KEY ENTITIES:');
      for (const e of topEntities) lines.push(`  • ${e.name} (${e.type})`);
    }

    return lines.join('\n');
  }

  // Fallback: no report yet — surface the highest-confidence facts.
  lines.push('SESSION SUMMARY: (no synthesised report yet — using top-confidence facts)');
  const top = [...fallbackFacts].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_FALLBACK_FACTS);
  if (top.length) {
    lines.push('', 'TOP-CONFIDENCE FACTS:');
    for (const f of top) lines.push(`  • ${f.content}`);
  }
  return lines.join('\n');
}

/**
 * Number the retrieved facts' sources (one [n] per distinct source, in first-
 * appearance order), build the cited passage block (each passage capped to
 * PASSAGE_CAP chars and tagged with its source's [n]), and return both the
 * passage text and the citation list for the `sources` SSE frame.
 */
export function numberSources(
  retrieved: RetrievedFact[],
  sourceMeta: Map<string, SourceMeta>,
): { passages: string; sources: CitationSource[] } {
  const numberBySource = new Map<string, number>();
  const sources: CitationSource[] = [];

  for (const r of retrieved) {
    if (!numberBySource.has(r.sourceId)) {
      const n = numberBySource.size + 1;
      numberBySource.set(r.sourceId, n);
      const meta = sourceMeta.get(r.sourceId);
      sources.push({
        n,
        title: meta?.title ?? null,
        domain: meta?.domain ?? null,
        url: meta?.url ?? null,
      });
    }
  }

  const passages = retrieved
    .map((r) => {
      const n = numberBySource.get(r.sourceId)!;
      const meta = sourceMeta.get(r.sourceId);
      const label = meta?.title || meta?.domain || meta?.url || 'source';
      return `[${n}] (${label})\n${r.content.slice(0, PASSAGE_CAP)}`;
    })
    .join('\n\n');

  return { passages, sources };
}

export const REPORT_SYSTEM = `You are an expert research analyst producing a structured report for a Research Desk session. Write ONLY from the CONTEXT supplied below — the session overview and the retrieved fact passages. Do not introduce outside knowledge.

RULES:
1. Structure the report with clear markdown headings and sections appropriate to the brief.
2. Ground every factual claim in the OVERVIEW or the PASSAGES. Cite sources inline using [n] markers wherever you draw on a passage.
3. Where the research does not cover an aspect of the brief, note this explicitly (e.g. "The session's research does not address X").
4. Be analytical, precise and concise. Distinguish established findings from uncertain or contested claims.
5. Conclude with a short "Source Coverage" note listing which [n] sources were most informative.
Never fabricate statistics, sources, or quotes.`;

/**
 * Assemble the system + user prompts for a brief-driven custom report.
 * Pure and network-free — all data is pre-fetched by the endpoint.
 */
export function buildReportPrompt(
  topic: string,
  brief: string,
  overview: string,
  passages: string,
): { system: string; user: string } {
  const passageBlock = passages.trim()
    ? `\n\nRETRIEVED PASSAGES (relevant facts from this session — cite with [n]):\n\n${passages}`
    : '\n\nRETRIEVED PASSAGES: (no closely-matching passages found — rely on the overview)';

  const user = `SESSION TOPIC: ${topic}

REPORT BRIEF: ${brief}

SESSION OVERVIEW:
${overview}${passageBlock}

Produce a structured markdown report that directly addresses the REPORT BRIEF above. Use the session research as your sole evidence base, cite [n] markers, and note any gaps in coverage.`;

  return { system: REPORT_SYSTEM, user };
}

/** Assemble the system + user prompts. History is capped to the last MAX_HISTORY_TURNS turns. */
export function buildChatPrompt(
  topic: string,
  overview: string,
  passages: string,
  history: HistoryTurn[],
  question: string,
): { system: string; user: string } {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const historyBlock = recent.length
    ? `\n\nRECENT CONVERSATION (for context):\n${recent
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n')}`
    : '';

  const passageBlock = passages.trim()
    ? `\n\nRETRIEVED PASSAGES (on-topic facts from this session — cite with [n]):\n\n${passages}`
    : '\n\nRETRIEVED PASSAGES: (none matched this question closely — rely on the overview)';

  const user = `SESSION TOPIC: ${topic}

SESSION OVERVIEW:
${overview}${passageBlock}${historyBlock}

QUESTION: ${question}

Answer using only the overview and passages above, citing [n] markers. If the session's research doesn't cover it, say so briefly.`;

  return { system: CHAT_SYSTEM, user };
}
