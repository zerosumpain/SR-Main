import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { RESOLUTION_VERSION } from './policy';
/** Hash actual evidence, not review time; an unchanged unsure verdict costs no new call. */
export async function loadEvidenceVersions(): Promise<Map<string, string>> {
  const rows = await db.execute(sql`
    SELECT e.id, md5(concat_ws('|', e.name, e.type_id, e.properties::text, e.aliases::text,
      coalesce(n.evidence, ''), coalesce(r.evidence, ''))) AS version
    FROM intel_entities e
    LEFT JOIN (SELECT ne.entity_id, string_agg(DISTINCT concat_ws(':', n.id, md5(coalesce(n.processed_content, n.raw_content, '')), ne.excerpt), '|' ORDER BY concat_ws(':', n.id, md5(coalesce(n.processed_content, n.raw_content, '')), ne.excerpt)) evidence
      FROM intel_note_entities ne JOIN intel_notes n ON n.id=ne.note_id WHERE n.graph_state='admitted' GROUP BY ne.entity_id) n ON n.entity_id=e.id
    LEFT JOIN (SELECT entity_id, string_agg(value, '|' ORDER BY value) evidence FROM (
      SELECT source_entity_id entity_id, concat_ws(':', type, target_entity_id) value FROM intel_relationships WHERE suppressed=false
      UNION ALL SELECT target_entity_id, concat_ws(':', type, source_entity_id) FROM intel_relationships WHERE suppressed=false
    ) edges GROUP BY entity_id) r ON r.entity_id=e.id WHERE e.merged_into_id IS NULL`);
  return new Map((rows.rows as {id: string; version: string}[]).map(r => [r.id, r.version]));
}
export function pairEvidenceVersion(a: string, b: string, versions: Map<string, string>): string {
  return `${RESOLUTION_VERSION}:${[a, b].sort().map(id => `${id}:${versions.get(id) ?? 'missing'}`).join('|')}`;
}
