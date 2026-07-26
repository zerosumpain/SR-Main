// Deep dive → intel graph. A completed research session already has its own
// cross-session entity index (used to dedup entities BETWEEN deep dives); this
// bridge is what puts the findings into the intel graph that the rest of jkai
// reasons over — /jkai/intel, @knowledge recall, alerts, the timeline.
//
// One LLM call per completed session, over a digest of the report (executive
// summary + cluster summaries + top facts) rather than every fact row, so the
// cost is bounded regardless of how big the dive was.
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
import { createHash } from 'crypto';
import { db } from '$lib/db';
import { eq, inArray } from 'drizzle-orm';
import { researchSessions, facts, entities, relationships } from '$lib/db/schema';
import type { ResearchReport } from './types';
import { extractIntoIntel, type AutoExtractOutcome } from '$lib/jkai/intel/auto-extract';

const MAX_RANKED_FACTS = 40;
/** Cap on pre-identified entities offered to the extractor as resolution hints. */
const MAX_HINT_ENTITIES = 60;
/** Cap on pre-identified relationships offered as hints. */
const MAX_HINT_RELATIONSHIPS = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a bare identifier that carries no meaning for an LLM extractor. */
export function isOpaqueId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Research-side structure offered to the extractor as a hint. The deep-dive
 * pipeline already did entity recognition over the raw sources with full page
 * context; re-deriving it from a summary throws that away. Passing it as
 * *hints* rather than bridging structurally keeps the intel graph's own typing
 * and dedup authoritative while giving the model far better recall.
 */
export interface ResearchStructure {
  entities: Array<{ name: string; type: string; description: string | null }>;
  relationships: Array<{ from: string; to: string; type: string; strength: number }>;
}

export const EMPTY_STRUCTURE: ResearchStructure = { entities: [], relationships: [] };

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
 * content) and the pre-identified `structure`. Both may be empty.
 */
export function buildResearchDigest(
  topic: string,
  report: ResearchReport,
  factText: Map<string, string> = new Map(),
  structure: ResearchStructure = EMPTY_STRUCTURE,
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

  if (structure.entities.length) {
    parts.push(
      'Entities already identified during research (prefer these names and types):\n' +
        structure.entities
          .slice(0, MAX_HINT_ENTITIES)
          .map((e) => `- ${e.name} [${e.type}]${e.description ? ` — ${e.description}` : ''}`)
          .join('\n'),
    );
  }

  if (structure.relationships.length) {
    parts.push(
      'Relationships already identified during research:\n' +
        structure.relationships
          .slice(0, MAX_HINT_RELATIONSHIPS)
          .map((r) => `- ${r.from} —[${r.type}]→ ${r.to}`)
          .join('\n'),
    );
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

/** fact id → content, for the ids the report actually references. */
async function loadFactText(report: ResearchReport): Promise<Map<string, string>> {
  const ids = collectFactIds(report).filter(isOpaqueId);
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: facts.id, content: facts.content })
    .from(facts)
    .where(inArray(facts.id, ids));
  return new Map(rows.map((r) => [r.id, r.content]));
}

/** The session's own entity/relationship recognition, strongest links first. */
async function loadStructure(sessionId: string): Promise<ResearchStructure> {
  const [entityRows, relRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities)
      .where(eq(entities.sessionId, sessionId)),
    db
      .select({
        fromEntityId: relationships.fromEntityId,
        toEntityId: relationships.toEntityId,
        relationshipType: relationships.relationshipType,
        strength: relationships.strength,
      })
      .from(relationships)
      .where(eq(relationships.sessionId, sessionId)),
  ]);

  const nameById = new Map(entityRows.map((e) => [e.id, e.name]));

  return {
    entities: entityRows.map((e) => ({ name: e.name, type: e.type, description: e.description })),
    relationships: relRows
      .map((r) => {
        const from = r.fromEntityId ? nameById.get(r.fromEntityId) : null;
        const to = r.toEntityId ? nameById.get(r.toEntityId) : null;
        if (!from || !to) return null;
        return { from, to, type: r.relationshipType, strength: r.strength };
      })
      .filter((r): r is ResearchStructure['relationships'][number] => Boolean(r))
      .sort((a, b) => b.strength - a.strength),
  };
}

/**
 * Extract a completed research session into the intel graph. No-op when the
 * session has no report yet. Safe to call more than once — the digest hash
 * gates re-extraction, so a session whose digest changed (e.g. because the UUID
 * bug was fixed) re-extracts automatically on the next sweep.
 */
export async function extractResearchIntoIntel(sessionId: string): Promise<AutoExtractOutcome> {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!session?.report) return { status: 'skipped' };

  const report = session.report as ResearchReport;
  const [factText, structure] = await Promise.all([
    loadFactText(report),
    loadStructure(session.id),
  ]);

  const digest = buildResearchDigest(session.topic, report, factText, structure);
  if (!digest.trim()) return { status: 'skipped' };

  return extractIntoIntel({
    kind: 'research',
    refId: session.id,
    title: session.topic,
    text: digest,
    contentHash: createHash('sha256').update(digest).digest('hex'),
    metadata: { sessionId: session.id, sourceUrl: `/deepdive/${session.id}` },
  });
}
