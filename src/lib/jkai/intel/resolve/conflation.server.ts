// Running the conflation detector — the DB and model half of ./conflation.ts.
//
// The three conflations this repairs were found by a person reading relation
// lists over SSH, which fixes one night's graph and nothing about the next. This
// is the same work on a schedule.
//
// Shape copied from `autoMergeDuplicates`, which is the closest precedent: sweep,
// judge, apply the confident ones, queue the rest. The bar is different, though,
// and deliberately so — a merge compares two things that both already exist,
// while a split can invent one, so the gate is an existence check rather than a
// confidence score. See `validateProposal`.
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { ensureCollection, upsertRecord, queryRecords } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { getLLMClient } from '$lib/llm/client';
import { resolveExtractionModel } from '$lib/server/models/workload-settings';
import { getGraphAnalysis, invalidateGraphAnalysis, type GraphAnalysis } from '../analytics/load';
import { splitEntity } from './split';
import {
  shortlistCandidates,
  validateProposal,
  type Candidate,
  type CandidateEntity,
  type SplitProposal,
} from './conflation';

export const SYSTEM_ACTOR = 'system';
/** Pinned — renaming this re-asks the model about every entity it has judged. */
export const CONFLATION_COLLECTION = 'intel_conflation_verdicts';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner'],
};

/** Model calls per sweep. A ceiling on cost, not on the shortlist. */
export const MAX_JUDGEMENTS_PER_SWEEP = 12;

export interface ConflationSweepResult {
  shortlisted: number;
  judged: number;
  /** Verdicts served from the cache because the vocabulary had not moved. */
  cached: number;
  applied: number;
  queued: number;
  skipped: number;
  failed: number;
  splits: Array<{ entity: string; target: string; moved: number }>;
  queue: Array<{ entity: string; targetName: string; why: string }>;
}

export async function ensureConflationCollection(): Promise<void> {
  await ensureCollection(
    CONFLATION_COLLECTION,
    {
      name: 'Intel Conflation Verdicts',
      description:
        'One record per entity the detector has judged — the vocabulary it judged, what it decided, and what was done.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

/**
 * Candidates read off the ANALYSED graph, not the database.
 *
 * `loadSnapshot` is where channel artefacts are excluded, and reading through it
 * means this honours that gate by construction rather than re-implementing it.
 * That matters immediately: querying the tables directly put `jkai` (397 edges)
 * and `Johnkelly Main` (307) at the top of the shortlist, and both are artefacts
 * the analytics layer already ignores — two wasted model calls a night, on the
 * two entities most certain to look conflated and least worth repairing.
 */
export function candidatesFromAnalysis(analysis: GraphAnalysis): {
  entities: CandidateEntity[];
  p95ByType: Map<string, number>;
} {
  const { index } = analysis;
  const relations = new Map<string, Set<string>>();
  for (const edges of index.edgesBetween.values()) {
    for (const e of edges) {
      for (const end of [e.source, e.target]) {
        const set = relations.get(end);
        if (set) set.add(e.type);
        else relations.set(end, new Set([e.type]));
      }
    }
  }

  const entities: CandidateEntity[] = [];
  const degreesByType = new Map<string, number[]>();
  for (const id of index.ids) {
    const node = index.byId.get(id);
    if (!node) continue;
    const degree = index.degree.get(id) ?? 0;
    entities.push({
      id,
      name: node.name,
      typeName: node.typeName,
      degree,
      relations: [...(relations.get(id) ?? [])],
    });
    if (degree > 0) {
      const list = degreesByType.get(node.typeName);
      if (list) list.push(degree);
      else degreesByType.set(node.typeName, [degree]);
    }
  }

  const p95ByType = new Map<string, number>();
  for (const [type, degrees] of degreesByType) {
    degrees.sort((a, b) => a - b);
    p95ByType.set(type, degrees[Math.floor(degrees.length * 0.95)] ?? 0);
  }
  return { entities, p95ByType };
}

interface Verdict {
  entityId: string;
  entityName: string;
  fingerprint: string;
  conflated: boolean;
  outcome: 'applied' | 'queued' | 'skipped';
  targetName?: string;
  why?: string;
  at: string;
}

async function loadVerdicts(): Promise<Map<string, Verdict>> {
  await ensureConflationCollection();
  const out = new Map<string, Verdict>();
  for (let offset = 0; ; offset += 200) {
    const { records } = await queryRecords(
      CONFLATION_COLLECTION,
      { limit: 200, offset },
      SYSTEM_ACTOR,
    );
    for (const r of records) {
      const v = r.data as unknown as Verdict;
      if (v?.entityId) out.set(v.entityId, v);
    }
    if (records.length < 200) break;
  }
  return out;
}

const SYSTEM_PROMPT = `You audit a knowledge graph for CONFLATED entities — one node that is really two things, because an extractor hung a relation on whatever noun was nearest.

Real examples from this graph:
- a town that had acquired the owner's bank cards, pets and daughter (has_credit_card, owns_pet, parent_of)
- a house that had absorbed the smart-home INSTALL (has_integration, flagged_risk, pending_update)
- a country that was also the national football team (coaches, defeated, participates_in)

Most entities are NOT conflated. A large entity with many relations of a similar kind is simply important — say so. Only answer "conflated" when a clearly separate referent is present, with its own vocabulary.

Reply with JSON only:
{"conflated": boolean, "relationTypes": string[], "targetName": string, "reason": string}

relationTypes: ONLY relation types from the list given, and only those belonging to the OTHER referent. Never all of them.
targetName: what the other referent is called. Prefer a name already in the neighbour list.
reason: one sentence.`;

async function judge(candidate: Candidate, neighbours: string[]): Promise<SplitProposal | null> {
  const modelCtx = await resolveExtractionModel();
  const { client, model } = await getLLMClient(modelCtx);

  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Entity: "${candidate.name}" (type: ${candidate.typeName}, ${candidate.degree} edges)
Relation types on it: ${[...new Set(candidate.relations)].join(', ')}
Some neighbours: ${neighbours.slice(0, 40).join(', ')}`,
      },
    ],
  });

  const raw = res.choices?.[0]?.message?.content ?? '';
  // Defensive, for the reason extract.ts is: the request is throughput-routed and
  // `response_format` adherence is not uniform across providers.
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(text) as SplitProposal;
    if (typeof parsed?.conflated !== 'boolean') return null;
    return {
      conflated: parsed.conflated,
      relationTypes: Array.isArray(parsed.relationTypes) ? parsed.relationTypes.map(String) : [],
      targetName: String(parsed.targetName ?? ''),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * One night's conflation work.
 *
 * `apply: false` runs everything except the writes, which is how the detector was
 * checked against production before it was allowed to touch it.
 */
export async function runConflationSweep(
  opts: { apply?: boolean; limit?: number } = {},
): Promise<ConflationSweepResult> {
  const apply = opts.apply !== false;
  const budget = Math.max(1, Math.min(opts.limit ?? MAX_JUDGEMENTS_PER_SWEEP, 50));

  const analysis = await getGraphAnalysis();
  const { entities, p95ByType } = candidatesFromAnalysis(analysis);
  const shortlist = shortlistCandidates(entities, p95ByType);
  const verdicts = await loadVerdicts();

  const result: ConflationSweepResult = {
    shortlisted: shortlist.length,
    judged: 0,
    cached: 0,
    applied: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    splits: [],
    queue: [],
  };

  // Name → entity, for the gate. Built from the analysed graph so a proposal can
  // only ever resolve onto something the rest of the layer can see.
  const byName = new Map<string, { id: string; typeName: string }>();
  for (const e of entities) {
    if (!byName.has(e.name)) byName.set(e.name, { id: e.id, typeName: e.typeName });
  }

  for (const candidate of shortlist) {
    if (result.judged >= budget) break;

    // A verdict is about a vocabulary. Nothing new to ask while it holds.
    const previous = verdicts.get(candidate.id);
    if (previous && previous.fingerprint === candidate.fingerprint) {
      result.cached++;
      continue;
    }

    let proposal: SplitProposal | null = null;
    try {
      const neighbours = [...(analysis.index.neighbours.get(candidate.id) ?? [])]
        .map((n) => analysis.index.byId.get(n)?.name)
        .filter((n): n is string => Boolean(n));
      proposal = await judge(candidate, neighbours);
      result.judged++;
    } catch (err) {
      result.failed++;
      console.warn(`[intel:conflation] judging "${candidate.name}" failed:`, err);
      continue;
    }
    if (!proposal) {
      result.failed++;
      continue;
    }

    const verdict = validateProposal(proposal, candidate, (name) => byName.get(name) ?? null);
    const record: Verdict = {
      entityId: candidate.id,
      entityName: candidate.name,
      fingerprint: candidate.fingerprint,
      conflated: proposal.conflated,
      outcome: verdict.action === 'apply' ? 'applied' : verdict.action === 'queue' ? 'queued' : 'skipped',
      targetName: proposal.targetName || undefined,
      why: verdict.action === 'apply' ? proposal.reason : verdict.why,
      at: new Date().toISOString(),
    };

    if (verdict.action === 'apply') {
      const wanted = new Set(proposal.relationTypes);
      // Re-read rather than trusting the shortlist's snapshot: the analysis is
      // cached for a minute and the graph may have moved under it.
      const typed = (
        await db.execute(sql`
          SELECT id, type FROM intel_relationships
          WHERE suppressed IS NOT TRUE
            AND (source_entity_id = ${candidate.id} OR target_entity_id = ${candidate.id})
        `)
      ).rows as Array<{ id: string; type: string }>;
      const moving = typed.filter((r) => wanted.has(r.type)).map((r) => r.id);

      if (!moving.length || moving.length >= typed.length) {
        record.outcome = 'skipped';
        record.why = 'nothing left to move by the time it ran';
        result.skipped++;
      } else if (!apply) {
        result.applied++;
        result.splits.push({ entity: candidate.name, target: proposal.targetName, moved: moving.length });
      } else {
        try {
          const out = await splitEntity({
            fromId: candidate.id,
            to: { entityId: verdict.targetId },
            relationshipIds: moving,
            reason: `Conflation detected automatically: ${proposal.reason}`,
          });
          result.applied++;
          result.splits.push({ entity: candidate.name, target: proposal.targetName, moved: out.moved });
        } catch (err) {
          result.failed++;
          record.outcome = 'skipped';
          record.why = err instanceof Error ? err.message : 'split failed';
          console.warn(`[intel:conflation] splitting "${candidate.name}" failed:`, err);
        }
      }
    } else if (verdict.action === 'queue') {
      result.queued++;
      result.queue.push({ entity: candidate.name, targetName: proposal.targetName, why: verdict.why });
    } else {
      result.skipped++;
    }

    if (apply) {
      await upsertRecord(
        CONFLATION_COLLECTION,
        { key: candidate.id, data: record as unknown as Record<string, unknown> },
        SYSTEM_ACTOR,
      ).catch((err) => console.warn('[intel:conflation] verdict write failed:', err));
    }
  }

  if (apply && result.applied > 0) invalidateGraphAnalysis();
  return result;
}
