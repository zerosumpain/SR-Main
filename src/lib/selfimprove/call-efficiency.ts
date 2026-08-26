// Tool calls per answered chat turn, measured from `jkai_tool_traces`.
//
// WHY THIS MOVED. This measurement used to read the Hermes SQLite session store
// on homeserv. That store froze on 2026-08-24 when Hermes stopped, and kept
// answering every query with rows dated before it died — so a policy trial could
// be, and nearly was, graded on evidence older than the trial itself. The trace
// recorder is now the only durable record of a turn's tool chain, and it lives
// in this app's own Postgres, so the measurement and the thing it measures can
// no longer drift apart.
//
// WHAT COUNTS AS WASTE. A repeat is a second call to the same tool inside one
// turn; a duplicate is a repeat with byte-identical arguments — the subset a
// cache or a batch would have removed outright. Discovery (`jkai_extended`
// list/schema round-trips) is counted separately: it is overhead, not work.
//
// SEGMENTS. Turns are not comparable. A browser/terminal debugging session
// legitimately runs dozens of steps; an ordinary chat answer should not. The
// headline metric is the CHAT segment; agentic turns are tracked beside it so a
// long, correct piece of work can never read as a regression (owner decision,
// 2026-07-29).
//
// COVERAGE. A trace row is written only for a turn that called at least one
// tool, so traces alone would compute the mean over tool-using turns and
// overstate it badly. The turn POPULATION therefore comes from the LLM ledger
// (`agent_actions`, `action_type='llm_call'`), whose `session_id` is the same
// jobId that keys `jkai_tool_traces` — one column joins the two.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

/**
 * Tools whose presence marks a turn as agentic — interactive dev work whose
 * step count is a property of the task, not of prompt quality.
 */
const AGENTIC_TOOL_PREFIXES = [
  'browser_',
  'terminal',
  'delegate_task',
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'scraper_script_',
];

function isAgenticTool(name: string): boolean {
  const bare = name.startsWith('jkai:') ? name.slice(5) : name;
  return AGENTIC_TOOL_PREFIXES.some((p) => bare.startsWith(p));
}

/** Clamp a day window to something a query can survive. */
export function clampDays(d: number | string | null | undefined, fallback = 30): number {
  const n = typeof d === 'string' ? parseInt(d, 10) : d;
  if (!n || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), 1), 365);
}

export interface CallPattern {
  /** Resolved tool name. */
  tool: string;
  /** Calls beyond the first within a turn, summed across turns. The number of
   *  calls a perfect batch/cache would have removed. */
  repeatCalls: number;
  /** How many distinct turns showed this repetition. */
  turns: number;
  /** Worst single-turn repeat count seen. */
  worstInOneTurn: number;
  /** Of `repeatCalls`, how many were byte-identical (same tool AND same args). */
  duplicateCalls: number;
}

export interface SegmentEfficiency {
  turns: number;
  totalCalls: number;
  meanCalls: number;
  medianCalls: number;
  p90Calls: number;
  maxCalls: number;
  /** Turns answered with no tool at all — healthy, not waste. */
  zeroToolTurns: number;
  /** Calls that repeated a tool already used in the same turn. */
  repeatCalls: number;
  /** Calls byte-identical to an earlier call in the same turn — pure waste. */
  duplicateCalls: number;
}

export interface CallEfficiency {
  days: number;
  /** Headline segment: ordinary question-answering turns. */
  chat: SegmentEfficiency;
  /** Interactive dev work — reported, never optimised against. */
  agentic: SegmentEfficiency;
  /** Both segments together. */
  all: SegmentEfficiency;
  /** Biggest repeat offenders in the CHAT segment — the engine's work list. */
  patterns: CallPattern[];
  /** Meta-tool discovery overhead (list/schema round-trips) across all turns. */
  discoveryCalls: number;
  generatedAt: string;
  /**
   * Newest turn in the underlying store, ignoring the window — i.e. how fresh
   * the DATA is, not when the measurement ran. `generatedAt` is always "now" and
   * so says nothing about whether anything is still being written.
   *
   * Null when the store is empty — which means "cannot vouch for freshness", and
   * callers must treat that as stale rather than as fresh.
   */
  newestTurnAt: string | null;
}

/** One turn's tool calls, normalised. `args` is a stable serialisation, so two
 *  calls are duplicates exactly when their `args` strings match. */
export interface TurnCalls {
  /** Turn identity — the jobId. Only used to keep turns apart. */
  key: string;
  calls: Array<{ name: string; args: string }>;
}

function emptySegment(): SegmentEfficiency {
  return {
    turns: 0,
    totalCalls: 0,
    meanCalls: 0,
    medianCalls: 0,
    p90Calls: 0,
    maxCalls: 0,
    zeroToolTurns: 0,
    repeatCalls: 0,
    duplicateCalls: 0,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function summarise(counts: number[], repeats: number, duplicates: number): SegmentEfficiency {
  if (counts.length === 0) return emptySegment();
  const sorted = [...counts].sort((a, b) => a - b);
  const total = counts.reduce((s, n) => s + n, 0);
  return {
    turns: counts.length,
    totalCalls: total,
    meanCalls: Number((total / counts.length).toFixed(2)),
    medianCalls: quantile(sorted, 0.5),
    p90Calls: quantile(sorted, 0.9),
    maxCalls: sorted[sorted.length - 1],
    zeroToolTurns: counts.filter((c) => c === 0).length,
    repeatCalls: repeats,
    duplicateCalls: duplicates,
  };
}

/**
 * Pure aggregation over already-fetched turns. Split out from the SQL so it is
 * directly testable — the numbers this produces decide whether a live policy
 * change is kept or rolled back, so they need tests that don't need a database.
 *
 * `totalTurns` is the turn POPULATION including turns that called no tool at
 * all; those never appear in `turns` and are attributed to chat, because a turn
 * answered without tools is by definition not agentic work.
 */
export function aggregateTurnEfficiency(
  turns: TurnCalls[],
  totalTurns: number,
  days: number,
  newestTurnAt: string | null = null,
): CallEfficiency {
  const chatCounts: number[] = [];
  const agenticCounts: number[] = [];
  let chatRepeats = 0;
  let chatDups = 0;
  let agenticRepeats = 0;
  let agenticDups = 0;
  let discoveryCalls = 0;

  const patterns = new Map<string, CallPattern>();

  for (const { calls } of turns) {
    const agentic = calls.some((c) => isAgenticTool(c.name));
    // Meta-tool list/schema round-trips are discovery overhead, not work.
    const real = calls.filter((c) => {
      if (c.name === 'jkai_extended' || c.name.startsWith('jkai_extended:')) {
        discoveryCalls++;
        return false;
      }
      return true;
    });

    const byTool = new Map<string, string[]>();
    for (const c of real) {
      const seen = byTool.get(c.name) ?? [];
      seen.push(c.args);
      byTool.set(c.name, seen);
    }

    let turnRepeats = 0;
    let turnDups = 0;
    for (const [tool, argsList] of byTool) {
      if (argsList.length <= 1) continue;
      const repeats = argsList.length - 1;
      turnRepeats += repeats;

      const argCounts = new Map<string, number>();
      for (const a of argsList) argCounts.set(a, (argCounts.get(a) ?? 0) + 1);
      let dups = 0;
      for (const n of argCounts.values()) if (n > 1) dups += n - 1;
      turnDups += dups;

      // Only chat turns feed the engine's work list — optimising an agentic
      // step count would be optimising against correct behaviour.
      if (!agentic) {
        const p = patterns.get(tool) ?? {
          tool,
          repeatCalls: 0,
          turns: 0,
          worstInOneTurn: 0,
          duplicateCalls: 0,
        };
        p.repeatCalls += repeats;
        p.turns += 1;
        p.worstInOneTurn = Math.max(p.worstInOneTurn, argsList.length);
        p.duplicateCalls += dups;
        patterns.set(tool, p);
      }
    }

    if (agentic) {
      agenticCounts.push(real.length);
      agenticRepeats += turnRepeats;
      agenticDups += turnDups;
    } else {
      chatCounts.push(real.length);
      chatRepeats += turnRepeats;
      chatDups += turnDups;
    }
  }

  const observed = chatCounts.length + agenticCounts.length;
  const silent = Math.max(0, totalTurns - observed);
  for (let i = 0; i < silent; i++) chatCounts.push(0);

  return {
    days,
    chat: summarise(chatCounts, chatRepeats, chatDups),
    agentic: summarise(agenticCounts, agenticRepeats, agenticDups),
    all: summarise(
      [...chatCounts, ...agenticCounts],
      chatRepeats + agenticRepeats,
      chatDups + agenticDups,
    ),
    patterns: [...patterns.values()].sort((a, b) => b.repeatCalls - a.repeatCalls).slice(0, 15),
    discoveryCalls,
    generatedAt: new Date().toISOString(),
    newestTurnAt,
  };
}

/**
 * Tool calls per answered turn over `days`, read from the trace table.
 *
 * `displayTool` is already un-masked at record time (`mcp_` prefix stripped,
 * `jkai_extended` invoke unwrapped), so names line up with the site-tools
 * registry without a second resolution pass here. A bare `jkai_extended` that
 * survived unwrapping is a list/schema call — discovery, counted apart.
 */
export async function getCallEfficiency(daysIn = 30): Promise<CallEfficiency> {
  const days = clampDays(daysIn);

  // One row per turn, with its calls in chain order. `args` is re-serialised by
  // Postgres from the stored jsonb, which normalises key order — so two calls
  // compare equal exactly when their arguments are equal, which is the property
  // the duplicate count depends on.
  const perTurn = await db.execute(sql`
    SELECT
      t.id                                                          AS key,
      coalesce(
        jsonb_agg(
          jsonb_build_object('name', s ->> 'displayTool', 'args', coalesce(s -> 'args', '{}'::jsonb))
          ORDER BY (s ->> 'seq')::int
        ) FILTER (WHERE s ->> 'displayTool' IS NOT NULL),
        '[]'::jsonb
      )                                                             AS calls
    FROM jkai_tool_traces t
    LEFT JOIN LATERAL jsonb_array_elements(t.steps -> 'steps') s ON true
    WHERE t.created_at >= now() - (${days}::int * INTERVAL '1 day')
    GROUP BY t.id
  `);

  const turns: TurnCalls[] = (perTurn.rows as Array<Record<string, unknown>>).map((r) => ({
    key: String(r.key ?? ''),
    calls: (Array.isArray(r.calls) ? r.calls : []).map((c) => {
      const call = c as { name?: unknown; args?: unknown };
      return {
        name: typeof call.name === 'string' ? call.name : '?',
        args: JSON.stringify(call.args ?? {}),
      };
    }),
  }));

  // Turn population, INCLUDING turns that used no tool and so wrote no trace.
  // `session_id` on an `llm_call` is the jobId — the same key `jkai_tool_traces`
  // is keyed on — so a turn is one distinct session_id.
  const totals = await db.execute(sql`
    SELECT count(DISTINCT session_id)::int AS turns
    FROM agent_actions
    WHERE action_type = 'llm_call'
      AND session_id IS NOT NULL
      AND input ->> 'source' = 'jkai-chat'
      AND created_at >= now() - (${days}::int * INTERVAL '1 day')
  `);
  const totalTurns = Number((totals.rows as Array<Record<string, unknown>>)[0]?.turns ?? 0);

  // Deliberately NOT windowed: the question is "when did this store last receive
  // anything", which a windowed max cannot answer — inside a dead window it
  // returns null, and inside a live one it just repeats the window.
  const fresh = await db.execute(sql`
    SELECT max(created_at) AS newest
    FROM agent_actions
    WHERE action_type = 'llm_call' AND input ->> 'source' = 'jkai-chat'
  `);
  const newestRaw = (fresh.rows as Array<Record<string, unknown>>)[0]?.newest;
  const newestTurnAt = newestRaw ? new Date(newestRaw as string).toISOString() : null;

  return aggregateTurnEfficiency(turns, totalTurns, days, newestTurnAt);
}
