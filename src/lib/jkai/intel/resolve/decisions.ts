import { loadEvidenceVersions, pairEvidenceVersion } from './evidence-version.server';
// Durable verdicts on entity pairs.
//
// The review queue used to be stateless: `findDuplicates` recomputed every pair
// from the graph on every call, and the only way to say "no, these are two
// different things" was a Dismiss button that wrote to a `Set` in the browser.
// Close the tab and the judgement was gone. On production that means the 490
// merges applied so far are the ONLY decisions the system has ever kept — every
// rejection has been thrown away, and the same pairs are re-proposed nightly.
//
// One row per unordered pair, keyed on `pairKey`. Recording a verdict is an
// upsert, so a human can overrule an earlier machine verdict and the pair still
// holds exactly one answer.
import { db, type DbExecutor } from '$lib/db';
import { intelMatchDecisions } from '$lib/db/schema';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { pairKeyOf } from './pair-key';

export type Verdict = 'same' | 'different' | 'unsure';
export type DecidedBy = 'human' | 'llm' | 'auto';

export interface MatchDecision {
  pairKey: string;
  aEntityId: string;
  bEntityId: string;
  verdict: Verdict;
  decidedBy: DecidedBy;
  evidenceVersion?: string | null;
  citations?: string[];
  stale?: boolean;
  verdictConfidence: number | null;
  rationale: string | null;
  model: string | null;
  aName: string | null;
  bName: string | null;
  createdAt: Date;
}

export interface RecordDecisionInput {
  aId: string;
  bId: string;
  verdict: Verdict;
  decidedBy: DecidedBy;
  /** The matcher's score at the time, for later calibration. */
  evidenceVersion?: string | null;
  citations?: string[];
  confidence?: number | null;
  /** How sure the decider was — a different question from the matcher's score. */
  verdictConfidence?: number | null;
  signals?: string[];
  rationale?: string | null;
  model?: string | null;
  aName?: string | null;
  bName?: string | null;
}

/**
 * Write (or overwrite) the verdict on one pair.
 *
 * A human verdict is never silently replaced by a machine one: the update is
 * guarded so an `llm` or `auto` write onto a row a person already decided is a
 * no-op. Without that guard the nightly adjudication stage would quietly undo
 * the queue every night, which is the same class of bug as the client-side
 * dismiss it replaces — a decision that does not survive.
 */
export async function recordDecision(input: RecordDecisionInput): Promise<void> {
  // Capture pre-decision records and graph features. Only human labels are evaluation truth.
  const evidence = await db.execute(sql`SELECT e.id,e.name,e.type_id,t.name AS type_name,e.properties,e.aliases,e.summary,e.embedding::text,
    (SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN r.source_entity_id=e.id THEN r.target_entity_id ELSE r.source_entity_id END),'[]') FROM intel_relationships r WHERE r.source_entity_id=e.id OR r.target_entity_id=e.id) AS neighbours,
    (SELECT count(DISTINCT ne.note_id)::int FROM intel_note_entities ne WHERE ne.entity_id=e.id) AS note_count
    FROM intel_entities e JOIN intel_entity_types t ON t.id=e.type_id WHERE e.id IN (${input.aId},${input.bId})`);
  await db.execute(sql`INSERT INTO intel_resolution_labels(pair_key,verdict,decided_by,features) VALUES (${pairKeyOf(input.aId,input.bId)},${input.verdict},${input.decidedBy},${JSON.stringify({ entities: evidence.rows, score: input.confidence, signals: input.signals ?? [], evidenceVersion: input.evidenceVersion, citations: input.citations ?? [] })}::jsonb)`);

  const key = pairKeyOf(input.aId, input.bId);
  const [a, b] = input.aId < input.bId ? [input.aId, input.bId] : [input.bId, input.aId];
  const swapped = a !== input.aId;

  await db
    .insert(intelMatchDecisions)
    .values({
      evidenceVersion: input.evidenceVersion,
      citations: input.citations ?? [],
      pairKey: key,
      aEntityId: a,
      bEntityId: b,
      verdict: input.verdict,
      decidedBy: input.decidedBy,
      confidence: input.confidence ?? null,
      verdictConfidence: input.verdictConfidence ?? null,
      signals: input.signals ?? [],
      rationale: input.rationale ?? null,
      model: input.model ?? null,
      aName: (swapped ? input.bName : input.aName) ?? null,
      bName: (swapped ? input.aName : input.bName) ?? null,
    })
    .onConflictDoUpdate({
      target: intelMatchDecisions.pairKey,
      set: {
        evidenceVersion: sql`excluded.evidence_version`,
        citations: sql`excluded.citations`,
        verdict: sql`excluded.verdict`,
        decidedBy: sql`excluded.decided_by`,
        confidence: sql`excluded.confidence`,
        verdictConfidence: sql`excluded.verdict_confidence`,
        signals: sql`excluded.signals`,
        rationale: sql`excluded.rationale`,
        model: sql`excluded.model`,
        aName: sql`coalesce(excluded.a_name, ${intelMatchDecisions.aName})`,
        bName: sql`coalesce(excluded.b_name, ${intelMatchDecisions.bName})`,
        updatedAt: new Date(),
      },
      // A machine may not overwrite a person. `excluded` is the incoming row.
      // `setWhere`, not the deprecated `where`: the latter is the same clause in
      // this drizzle version and the target-predicate one in others, and the
      // difference between "update only these rows" and "conflict only on these
      // rows" is the whole guarantee.
      setWhere: sql`${intelMatchDecisions.decidedBy} <> 'human' OR excluded.decided_by = 'human'`,
    });
}

/** Every decision on record, keyed by pair. */
export async function loadDecisions(): Promise<Map<string, MatchDecision>> {
  const [rows, versions] = await Promise.all([db.select().from(intelMatchDecisions), loadEvidenceVersions()]);
  return new Map(
    rows.map((r) => [
      r.pairKey,
      {
        evidenceVersion: r.evidenceVersion,
        citations: r.citations,
        stale: r.decidedBy !== 'human' && r.evidenceVersion !== pairEvidenceVersion(r.aEntityId, r.bEntityId, versions),
        pairKey: r.pairKey,
        aEntityId: r.aEntityId,
        bEntityId: r.bEntityId,
        verdict: r.verdict as Verdict,
        decidedBy: r.decidedBy as DecidedBy,
        verdictConfidence: r.verdictConfidence,
        rationale: r.rationale,
        model: r.model,
        aName: r.aName,
        bName: r.bName,
        createdAt: r.createdAt,
      },
    ]),
  );
}

/** Drop a verdict entirely, putting the pair back in the queue. */
export async function clearDecision(aId: string, bId: string): Promise<void> {
  await db.delete(intelMatchDecisions).where(inArray(intelMatchDecisions.pairKey, [pairKeyOf(aId, bId)]));
}

/**
 * Repoint decisions after a merge, so a judgement is not lost when one side of
 * a DIFFERENT pair is absorbed.
 *
 * Without this, merging B into A silently orphans every "B is not C" verdict:
 * the pair `B|C` can never be proposed again, but `A|C` has no verdict, so the
 * question comes back wearing a new name. Rewriting the id keeps the answer.
 *
 * Self-pairs and collisions are dropped rather than merged — two verdicts about
 * the same pair after a rewrite is a contradiction, and the safest reading of a
 * contradiction is to ask again.
 */
export async function repointDecisions(survivorId: string, mergedId: string, executor: DbExecutor = db): Promise<number> {
  const affected = await executor
    .select()
    .from(intelMatchDecisions)
    .where(
      or(eq(intelMatchDecisions.aEntityId, mergedId), eq(intelMatchDecisions.bEntityId, mergedId)),
    );
  if (!affected.length) return 0;

  const taken = new Set((await executor.select({ k: intelMatchDecisions.pairKey }).from(intelMatchDecisions)).map((r) => r.k));

  const doomed: string[] = [];
  const moves: Array<{ id: string; a: string; b: string; key: string }> = [];
  for (const row of affected) {
    const other = row.aEntityId === mergedId ? row.bEntityId : row.aEntityId;
    // The pair collapses onto itself — "A is not A" says nothing.
    if (other === survivorId) {
      doomed.push(row.id);
      continue;
    }
    const key = pairKeyOf(survivorId, other);
    // Another row already answers this question. Two verdicts about one pair is
    // a contradiction, and the safest reading of a contradiction is to ask again.
    if (taken.has(key)) {
      // Preserve a cannot-link constraint when two histories converge.
      if (row.decidedBy === 'human' && row.verdict === 'different') {
        await executor.update(intelMatchDecisions).set({ verdict: 'different', decidedBy: 'human', rationale: row.rationale,
          citations: row.citations, evidenceVersion: null, updatedAt: new Date() }).where(eq(intelMatchDecisions.pairKey,key));
      }
      doomed.push(row.id);
      continue;
    }
    taken.delete(row.pairKey);
    taken.add(key);
    const [a, b] = survivorId < other ? [survivorId, other] : [other, survivorId];
    moves.push({ id: row.id, a, b, key });
  }

  const apply = async (tx: DbExecutor) => {
    if (doomed.length) {
      await tx.delete(intelMatchDecisions).where(inArray(intelMatchDecisions.id, doomed));
    }
    for (const m of moves) {
      await tx
        .update(intelMatchDecisions)
        .set({ aEntityId: m.a, bEntityId: m.b, pairKey: m.key, updatedAt: new Date() })
        .where(eq(intelMatchDecisions.id, m.id));
    }
  };
  if (executor === db) await db.transaction(apply); else await apply(executor);

  return moves.length;
}
