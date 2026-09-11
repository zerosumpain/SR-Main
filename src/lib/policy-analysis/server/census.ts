/**
 * THE ELEVEN PROBES — the SQL half of the purge receipt.
 *
 * The receipt's shape, wording and file rendering are pure and live in
 * `$lib/policy-analysis/receipt`, which the dashboard imports. This half holds
 * the queries, so importing it from a page would put drizzle and a database
 * connection in the browser bundle.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import type { Probe } from '../receipt';

/**
 * Every place a reference to one analysis can live.
 *
 * `census.test.ts` checks this list against `schema.ts`: a new table carrying an
 * `analysis_id` fails that test until it is listed here. A probe that is missing
 * is indistinguishable from a probe that passes, which is why the completeness is
 * asserted mechanically rather than reviewed.
 */
const PROBES: { table: string; what: string; query: (id: string) => ReturnType<typeof sql> }[] = [
  { table: 'policy_analyses', what: 'the assessment row itself', query: (id) => sql`select count(*)::int as n from policy_analyses where id = ${id}::uuid` },
  { table: 'policy_documents', what: 'the uploaded document and its extracted text', query: (id) => sql`select count(*)::int as n from policy_documents where analysis_id = ${id}::uuid` },
  { table: 'policy_stages', what: 'stage outputs, warnings and errors', query: (id) => sql`select count(*)::int as n from policy_stages where analysis_id = ${id}::uuid` },
  { table: 'policy_executions', what: 'execution attempts', query: (id) => sql`select count(*)::int as n from policy_executions e join policy_stages s on s.id = e.stage_id where s.analysis_id = ${id}::uuid` },
  { table: 'policy_model_calls', what: 'the model-call audit', query: (id) => sql`select count(*)::int as n from policy_model_calls c join policy_executions e on e.id = c.execution_id join policy_stages s on s.id = e.stage_id where s.analysis_id = ${id}::uuid` },
  { table: 'policy_artefacts', what: 'every claim, actor, play and finding', query: (id) => sql`select count(*)::int as n from policy_artefacts where analysis_id = ${id}::uuid` },
  { table: 'policy_provenance', what: 'the links between them', query: (id) => sql`select count(*)::int as n from policy_provenance where analysis_id = ${id}::uuid` },
  { table: 'policy_persona_observations', what: 'what this run contributed to the persona library', query: (id) => sql`select count(*)::int as n from policy_persona_observations where analysis_id = ${id}::uuid` },
  { table: 'policy_share', what: 'share links minted against it', query: (id) => sql`select count(*)::int as n from policy_share where analysis_id = ${id}::uuid` },
  // The two that no cascade reaches, and that a plain DELETE left behind for two
  // months. They are the reason this census exists rather than a success message.
  { table: 'workflow_runs', what: 'queue envelopes naming it', query: (id) => sql`select count(*)::int as n from workflow_runs where input_data ->> 'analysisId' = ${id}` },
  { table: 'policy_artefacts (other assessments)', what: 'cross-policy findings written about it elsewhere', query: (id) => sql`select count(*)::int as n from policy_artefacts where kind = 'cross_policy' and data ->> 'otherAnalysisId' = ${id}` },
];

/** The tables the census asks about, for the completeness test. */
export const PROBE_TABLES = PROBES.map((p) => p.table);

/** Run every probe. Counts, not rows: a census must not read back the thing it is checking is gone. */
export async function census(analysisId: string): Promise<Probe[]> {
  const out: Probe[] = [];
  for (const probe of PROBES) {
    const result = await db.execute(probe.query(analysisId));
    const rows = Number((result as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0);
    out.push({ table: probe.table, what: probe.what, rows });
  }
  return out;
}
