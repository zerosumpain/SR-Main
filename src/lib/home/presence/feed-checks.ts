import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses, householdMember } from '$lib/db/schema';

export interface FeedCheck {
  source: 'companion' | 'life360';
  checkedAt: Date | null;
}

/** Successful source reads, separate from phone GPS timestamps. Only ask for
 * sharing subjects already authorised by the page's viewer scope. A successful
 * empty companion read counts; a failed or unfinished import does not. */
export async function loadFeedChecks(subjects: string[]): Promise<Record<string, FeedCheck>> {
  if (!subjects.length) return {};
  const result = await db.execute(sql`
    select m.subject, m.source, checked.ts as checked_at
    from ${householdMember} m
    left join lateral (
      select p.ts
      from ${heartbeatPulses} p
      join ${heartbeatActions} a on a.id = p.action_id
      where a.name = case m.source
        when 'companion' then 'household-live'
        when 'life360' then 'daydream-observe'
      end
        and p.outcome = 'ok'
        and p.ts >= now() - interval '1 day'
        and case m.source
          when 'companion' then
            (p.details->'companion'->>'pages')::int > 0
            and p.details->'companion'->>'error' is null
            and p.details->'companion'->>'more' = 'false'
          when 'life360' then p.details->m.subject ? 'trailId'
          else false
        end
      order by p.ts desc
      limit 1
    ) checked on true
    where m.subject in ${subjects} and m.source in ('companion', 'life360')
  `);
  return Object.fromEntries(result.rows.map((row) => [String(row.subject), {
    source: row.source as FeedCheck['source'],
    checkedAt: row.checked_at == null ? null : new Date(row.checked_at as string),
  }]));
}
