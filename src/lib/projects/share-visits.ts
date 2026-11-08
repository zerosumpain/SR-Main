// The share-link visitor rows (project_share_visit): written where a link is
// validated, read for the owner's Share panel. What a row holds and why is in
// ./share-visitor; this is only the database side. Server-only.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { projectShareVisits } from '$lib/db/schema';
import {
  BOT_LABEL,
  PREVIEW_LABEL,
  visitStats,
  type ShareVisit,
  type ShareVisitStats,
  type VisitTotals,
  type VisitorRow,
} from './share-visitor';

/** Visitor rows a link may hold. Past it, people already counted are still updated; no one new is added. */
export const VISITOR_ROW_CAP = 500;
/** Visitor rows the Share panel lists per link, latest first. */
export const VISITORS_SHOWN = 50;

const t = projectShareVisits;

/**
 * Count one request against a link's visitor. A page open by someone new adds
 * a row; anything else only updates the row it belongs to, so a page's own data
 * requests never add a visitor on their own. Awaited by nobody on the request
 * path (see validateProjectShare).
 */
export async function recordShareVisit(shareId: string, visit: ShareVisit): Promise<void> {
  if (!visit.visitorHash) return;
  const opens = visit.open === false ? 0 : 1;
  const latest = {
    ...(visit.agent ? { agent: visit.agent } : {}),
    ...(visit.country ? { country: visit.country } : {}),
  };
  const known = await db
    .update(t)
    .set({ lastSeen: new Date(), requests: sql`${t.requests} + 1`, opens: sql`${t.opens} + ${opens}`, ...latest })
    .where(and(eq(t.shareId, shareId), eq(t.visitorHash, visit.visitorHash), eq(t.networkHash, visit.networkHash)))
    .returning({ id: t.id });
  if (known.length > 0 || visit.open === false) return;
  // Under the cap only. Two first opens at once both reach here; the conflict
  // clause makes the second an update, not an error.
  await db.execute(sql`
    insert into project_share_visit (share_id, visitor_hash, network_hash, agent, country, opens, requests)
    select ${shareId}, ${visit.visitorHash}, ${visit.networkHash}, ${visit.agent}, ${visit.country}, ${opens}, 1
    where (select count(*) from project_share_visit where share_id = ${shareId}) < ${VISITOR_ROW_CAP}
    on conflict (share_id, visitor_hash, network_hash) do update set
      last_seen = now(),
      requests = project_share_visit.requests + 1,
      opens = project_share_visit.opens + excluded.opens,
      agent = coalesce(excluded.agent, project_share_visit.agent),
      country = coalesce(excluded.country, project_share_visit.country)`);
}

/** A person rather than a link previewer or a bot (share-visitor's isAutomated, in SQL). */
const human = (alias: string) =>
  sql.raw(`(coalesce(${alias}.agent, '') <> '${BOT_LABEL}' and coalesce(${alias}.agent, '') not like '${PREVIEW_LABEL} ·%')`);

interface TotalsRow extends Record<string, unknown> {
  share_id: string;
  rows: number;
  opens: number;
  browsers: number;
  networks: number;
  countries: string[] | null;
}

interface VisitorDbRow extends Record<string, unknown> {
  share_id: string;
  browser: number | null;
  network: number | null;
  agent: string | null;
  country: string | null;
  opens: number;
  first_seen: Date | string;
  last_seen: Date | string;
}

/**
 * Every link's visitor numbers for one project, in two queries whatever the
 * number of links: the totals, and each link's newest rows with each browser
 * and network numbered in the order it first came. Hashes stay in here.
 */
export async function shareVisitStats(
  projectKey: string,
  shares: { id: string; useCount: number }[],
): Promise<Map<string, ShareVisitStats>> {
  const out = new Map<string, ShareVisitStats>();
  if (shares.length === 0) return out;
  const totals = await db.execute<TotalsRow>(sql`
    select v.share_id,
      count(*)::int as rows,
      coalesce(sum(v.opens) filter (where ${human('v')}), 0)::int as opens,
      (count(distinct v.visitor_hash) filter (where ${human('v')}))::int as browsers,
      (count(distinct nullif(v.network_hash, '')) filter (where ${human('v')}))::int as networks,
      array_agg(distinct v.country) filter (where ${human('v')} and v.country is not null) as countries
    from project_share_visit v
    join project_share s on s.id = v.share_id
    where s.project_key = ${projectKey}
    group by v.share_id`);
  const visitors = await db.execute<VisitorDbRow>(sql`
    with v as (
      select v.id, v.share_id, v.visitor_hash, v.network_hash, v.agent, v.country, v.opens, v.first_seen, v.last_seen,
        ${human('v')} as human
      from project_share_visit v
      join project_share s on s.id = v.share_id
      where s.project_key = ${projectKey}
    ), firsts as (
      select v.*,
        min(first_seen) over (partition by share_id, visitor_hash) as visitor_first,
        min(first_seen) over (partition by share_id, network_hash) as network_first
      from v
    ), ranked as (
      select firsts.*,
        case when human then dense_rank() over (partition by share_id, human order by visitor_first, visitor_hash) end as browser,
        case when human and network_hash <> '' then
          dense_rank() over (partition by share_id, human and network_hash <> '' order by network_first, network_hash) end as network,
        row_number() over (partition by share_id order by last_seen desc, id) as nth
      from firsts
    )
    select share_id, browser::int as browser, network::int as network, agent, country, opens, first_seen, last_seen
    from ranked
    where nth <= ${VISITORS_SHOWN}
    order by share_id, last_seen desc, id`);

  const byShare = new Map<string, VisitTotals>();
  for (const r of totals.rows) {
    byShare.set(r.share_id, {
      rows: Number(r.rows),
      opens: Number(r.opens),
      browsers: Number(r.browsers),
      networks: Number(r.networks),
      countries: r.countries ?? [],
    });
  }
  const rowsByShare = new Map<string, VisitorRow[]>();
  for (const r of visitors.rows) {
    const list = rowsByShare.get(r.share_id) ?? [];
    list.push({
      browser: r.browser === null ? null : Number(r.browser),
      network: r.network === null ? null : Number(r.network),
      agent: r.agent,
      country: r.country,
      opens: Number(r.opens),
      firstSeen: new Date(r.first_seen),
      lastSeen: new Date(r.last_seen),
    });
    rowsByShare.set(r.share_id, list);
  }
  for (const s of shares) out.set(s.id, visitStats(s.useCount, byShare.get(s.id), rowsByShare.get(s.id) ?? []));
  return out;
}
