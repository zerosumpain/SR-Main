// The readable digest of a finished research session — executive summary,
// cluster summaries, ranked facts and timeline, flattened into the prose that
// becomes the derived intel note's body.
//
// This module used to BE the bridge into the intel graph: it built this digest
// and asked the intel extractor to re-derive entities and relationships from
// it, with the session's own graph passed alongside as textual hints. That is
// gone — $lib/deepdive/graph-commit hands intel the session's actual entities
// and relationships instead, which is both higher fidelity and one fewer model
// call. What survives here is the part that was always right: turning a report
// into something a person can read.
//
// ── The UUID bug (fixed 2026-07-26) ──────────────────────────────────────────
// `ResearchReport.ranked_facts`, `timeline[].facts` and `clusters[].fact_ids`
// are arrays of fact *IDs*, not fact prose — postprocess.ts writes
// `factScores.map(f => f.id)`. The original digest filtered them with
// `typeof f === 'string'`, which every UUID passes, so every research-derived
// intel note was ~160 lines of raw UUIDs under a "Key facts:" heading. The
// extractor had almost no evidence to work from, and the note itself was
// unreadable in /jkai/intel.
//
// The fix: resolve IDs against the `fact` table before building the digest, and
// drop anything still UUID-shaped afterwards so a stale or foreign ID can never
// reach the model again. Legacy reports that happen to hold prose still work —
// an unmapped non-UUID string is passed through unchanged.
import type { ResearchReport } from './types';

const MAX_RANKED_FACTS = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a bare identifier that carries no meaning for an LLM extractor. */
export function isOpaqueId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Turn a report string that may be a fact ID into readable prose. Returns null
 * when the value is an unresolvable opaque id — the caller drops it.
 */
function resolveFact(value: unknown, factText: Map<string, string>): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mapped = factText.get(trimmed);
  if (mapped) return mapped;
  // Unmapped and id-shaped → the fact row is gone (or belongs to another
  // session). Emitting it would reproduce the original bug.
  if (isOpaqueId(trimmed)) return null;
  return trimmed;
}

/**
 * Flatten a research report into the text worth extracting entities from.
 *
 * Pure so it stays unit-testable: the caller supplies `factText` (fact id →
 * content), which may be empty.
 */
export function buildResearchDigest(
  topic: string,
  report: ResearchReport,
  factText: Map<string, string> = new Map(),
): string {
  const parts: string[] = [`Research topic: ${topic}`];

  if (report.executive_summary) {
    parts.push(`Executive summary:\n${report.executive_summary}`);
  }

  const clusters = (report.clusters ?? []).filter((c) => c?.title || c?.summary);
  if (clusters.length) {
    parts.push(
      'Findings:\n' + clusters.map((c) => `- ${c.title}: ${c.summary ?? ''}`.trim()).join('\n'),
    );
  }

  const factLines = (report.ranked_facts ?? [])
    .map((f) => resolveFact(f, factText))
    .filter((f): f is string => Boolean(f));
  if (factLines.length) {
    parts.push(
      'Key facts:\n' + factLines.slice(0, MAX_RANKED_FACTS).map((f) => `- ${f}`).join('\n'),
    );
  }

  const timelineLines = (report.timeline ?? [])
    .filter((t) => t?.date)
    .map((t) => {
      const resolved = (t.facts ?? [])
        .map((f) => resolveFact(f, factText))
        .filter((f): f is string => Boolean(f));
      return resolved.length ? `- ${t.date}: ${resolved.join('; ')}` : null;
    })
    .filter((l): l is string => Boolean(l));
  if (timelineLines.length) {
    parts.push('Timeline:\n' + timelineLines.join('\n'));
  }

  return parts.join('\n\n');
}

/** Every fact id referenced anywhere in the report, deduped. */
export function collectFactIds(report: ResearchReport): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.add(v.trim());
  };
  (report.ranked_facts ?? []).forEach(add);
  (report.timeline ?? []).forEach((t) => (t?.facts ?? []).forEach(add));
  (report.clusters ?? []).forEach((c) => (c?.fact_ids ?? []).forEach(add));
  return [...ids];
}
