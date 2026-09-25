/**
 * The I/O half of the context route: the router call, and resolving the names
 * it returns to entities in the graph. The rules live in `./context-route`.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { pgTextArray } from '$lib/db/sql-array';
import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { resolveContextRouterModel } from '$lib/server/models/workload-settings';
import { thinkingRequestParams } from '$lib/models/thinking';
import { canonicalName } from '$lib/jkai/intel/resolve/match';
import { OWNER_INTEL_SCOPE } from '$lib/jkai/intel/scope';
import type { RosterCluster } from '$lib/jkai/intel/context';
import { fallbackRoute, parseRoute, renderRouterInput, ROUTER_SYSTEM, type ContextRoute } from './context-route';

/**
 * How long a turn waits for the router before retrieving without it.
 *
 * The router's model answers in about half a second; this is the ceiling on a
 * bad day, and it is paid in front of the first token. Past it, the turn takes
 * `fallbackRoute` — the old retrieval, minus the roster — rather than stall.
 */
const ROUTER_TIMEOUT_MS = 2500;

export interface RoutedTurn {
  route: ContextRoute;
  /** Wall time of the router call, for the turn stamp. */
  ms: number;
  /** Why the router did not decide, when it did not. */
  error?: string;
}

export async function routeTurn(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }>,
  roster: readonly RosterCluster[],
): Promise<RoutedTurn> {
  const started = Date.now();
  const labels = roster.map((c) => c.label);
  try {
    const ctx = await resolveContextRouterModel();
    const { client, model } = await getLLMClient(ctx);
    const res = await withActivity('context-router', () =>
      client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: ROUTER_SYSTEM },
            { role: 'user', content: renderRouterInput(message, history, labels) },
          ],
          temperature: 0,
          max_tokens: 300,
          response_format: { type: 'json_object' },
          // Reasoning would spend the whole latency budget on routing JSON.
          ...thinkingRequestParams(ctx.provider, 'off', ctx.modelId),
        } as Parameters<typeof client.chat.completions.create>[0],
        { signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS) },
      ),
    );
    const content = (res as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content ?? '';
    const route = parseRoute(content, labels);
    if (route) return { route, ms: Date.now() - started };
    return { route: fallbackRoute(message), ms: Date.now() - started, error: 'unparseable router output' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[context-route] router failed, using fallback:', error);
    return { route: fallbackRoute(message), ms: Date.now() - started, error };
  }
}

export interface Anchor {
  id: string;
  name: string;
  type: string;
}

/** Per name, how many graph entities it may anchor. A common name must not drag in every namesake. */
const ANCHORS_PER_NAME = 2;

/**
 * The graph entities the router's names refer to — by name, alias or
 * canonical form, never by embedding.
 *
 * This is the step that stops "Shit bra" landing on MAN, MOD, WAN and URN: a
 * vector search always returns its nearest neighbours however far away they
 * are, while a name either matches an entity or it does not. Same lookup shape
 * as ingest's preview resolver. Ties go to the entity more notes mention.
 *
 * Chat's context is the owner's (a member scope gets no intel section at all),
 * so anchors come from the owner's scope only.
 */
export async function resolveAnchors(names: readonly string[]): Promise<Anchor[]> {
  if (!names.length) return [];
  const lower = names.map((n) => n.toLowerCase());
  const canonical = names.map(canonicalName).filter(Boolean);
  const { rows } = await db.execute(sql`
    SELECT e.id, e.name, coalesce(t.name, '') AS type_name,
           (SELECT count(*) FROM intel_note_entities ne WHERE ne.entity_id = e.id) AS mentions,
           CASE
             WHEN lower(e.name) = ANY(${pgTextArray(lower)}::text[]) THEN lower(e.name)
             WHEN e.canonical_name = ANY(${pgTextArray(canonical)}::text[]) THEN e.canonical_name
             ELSE (SELECT lower(a.v) FROM jsonb_array_elements_text(e.aliases) AS a(v)
                   WHERE lower(a.v) = ANY(${pgTextArray(lower)}::text[]) LIMIT 1)
           END AS matched
    FROM intel_entities e
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
    WHERE e.merged_into_id IS NULL
      AND e.space_id = ANY(${pgTextArray(OWNER_INTEL_SCOPE)}::text[])
      AND (
        lower(e.name) = ANY(${pgTextArray(lower)}::text[])
        OR e.canonical_name = ANY(${pgTextArray(canonical)}::text[])
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(e.aliases) AS a(v)
          WHERE lower(a.v) = ANY(${pgTextArray(lower)}::text[])
        )
      )
    ORDER BY mentions DESC
    LIMIT 40
  `);
  const perName = new Map<string, number>();
  const out: Anchor[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const key = String(r.matched ?? r.name);
    const n = perName.get(key) ?? 0;
    if (n >= ANCHORS_PER_NAME) continue;
    perName.set(key, n + 1);
    out.push({ id: String(r.id), name: String(r.name), type: String(r.type_name ?? '') });
  }
  return out;
}

/**
 * The roster clusters a turn is about: the ones the router named, plus the ones
 * its anchors belong to. One line each in the context block — never the roster.
 */
export function clustersForTurn(
  route: ContextRoute,
  anchors: readonly Anchor[],
  roster: readonly RosterCluster[],
): RosterCluster[] {
  const anchorIds = new Set(anchors.map((a) => a.id));
  return roster.filter((c) => route.clusters.includes(c.label) || c.members.some((m) => anchorIds.has(m)));
}
