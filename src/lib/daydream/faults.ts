// src/lib/daydream/faults.ts
//
// The fault ledger — what daydreaming could not do, and what would fix it.
//
// Every writer is SOFT: a ledger that cannot be written must never cost the
// tick that tried to write it. Every fault carries a `wants` from a closed
// vocabulary, because "self-improve should build new intelligence sources"
// only works if each gap says what shape the source has to be — a plain
// number with no arguments, a reader for rows it already has ids for, a
// connector for a source that went quiet, or simply more days.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamFaults } from '$lib/db/schema';
import { errMsg } from './types';

export const FAULT_KINDS = [
  'metric_unknown',
  'needs_source',
  'audit_drop',
  'lead_barren',
  'lookup_failed',
  'tool_failed',
  'tool_barren',
  'silent_source',
  'source_error',
  // From the workflow doctor, 2026-09-04. A canvas whose node type was renamed
  // out of the registry can never run again, and no runtime tool can fix it —
  // it needs a migration in the repo. Folding the doctor in here rather than
  // giving it a second wire into self-improve is what makes the two engines
  // one: its findings arrive by the same door as every other gap.
  'workflow_dead_node',
  'workflow_failing',
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export const WANTS = [
  'numeric_tool',
  'reader_tool',
  'connector',
  'more_days',
  'repair',
  'decline',
  /**
   * Needs REPO CODE — a route, a schema, a migration. Nothing a runtime custom
   * tool can be, and nothing the doctor's own narrow config whitelist can
   * reach. It becomes a `feature` backlog item and, once the owner accepts it,
   * a change request to the autonomous builder.
   */
  'code_change',
] as const;
export type Wants = (typeof WANTS)[number];

/** The wants that are BUILDABLE — what self-improve reads first. */
export const BUILDABLE_WANTS: ReadonlyArray<Wants> = ['numeric_tool', 'reader_tool', 'connector', 'code_change'];

/** What a fault of this kind naturally asks for. */
export function wantsFor(kind: FaultKind): Wants {
  switch (kind) {
    case 'metric_unknown':
      return 'numeric_tool';
    case 'needs_source':
    case 'lookup_failed':
      return 'reader_tool';
    case 'silent_source':
    case 'source_error':
      return 'connector';
    case 'tool_failed':
      return 'repair';
    case 'tool_barren':
      return 'decline';
    case 'workflow_dead_node':
    case 'workflow_failing':
      return 'code_change';
    case 'lead_barren':
    case 'audit_drop':
    default:
      return 'more_days';
  }
}

/** The metric names a rejection string names, or none. Both the proposer
 *  (`unknown metric: X`) and the ponder lead audit (`unknown metrics X,Y —
 *  the vocabulary is …`) are covered. */
export function unknownMetricsIn(reason: string): string[] {
  const m = /unknown metrics?:?\s+([^—\n]+?)(?:\s+—|$)/i.exec(reason);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && x !== '(missing)' && x.length <= 80);
}

export interface RaiseInput {
  kind: FaultKind;
  identifier: string;
  site: string;
  detail?: string | null;
  subject?: string | null;
  wants?: Wants;
}

/** Raise (or re-raise) a fault. Never throws. */
export async function raiseFault(input: RaiseInput): Promise<void> {
  const identifier = input.identifier.trim().slice(0, 200);
  if (!identifier) return;
  const now = new Date();
  try {
    await db
      .insert(daydreamFaults)
      .values({
        kind: input.kind,
        identifier,
        wants: input.wants ?? wantsFor(input.kind),
        site: input.site.slice(0, 120),
        detail: input.detail?.slice(0, 1000) ?? null,
        subject: input.subject ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [daydreamFaults.kind, daydreamFaults.identifier],
        set: {
          count: sql`${daydreamFaults.count} + 1`,
          lastSeenAt: now,
          detail: input.detail?.slice(0, 1000) ?? sql`${daydreamFaults.detail}`,
          site: input.site.slice(0, 120),
          // A closed fault that recurs is open again — the fix did not hold.
          status: sql`case when ${daydreamFaults.status} = 'closed' then 'open' else ${daydreamFaults.status} end`,
        },
      });
  } catch (err) {
    console.warn(`[daydream] fault not recorded (${input.kind}:${identifier}): ${errMsg(err)}`);
  }
}

export interface FaultRow {
  id: number;
  kind: FaultKind;
  identifier: string;
  wants: Wants;
  site: string;
  detail: string | null;
  subject: string | null;
  count: number;
  status: string;
  closedBy: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function openFaults(opts: { wants?: ReadonlyArray<Wants>; limit?: number } = {}): Promise<FaultRow[]> {
  const rows = await db
    .select()
    .from(daydreamFaults)
    .where(and(eq(daydreamFaults.status, 'open'), ...(opts.wants ? [inArray(daydreamFaults.wants, [...opts.wants])] : [])))
    .orderBy(desc(daydreamFaults.count), desc(daydreamFaults.lastSeenAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as FaultKind,
    identifier: r.identifier,
    wants: r.wants as Wants,
    site: r.site,
    detail: r.detail,
    subject: r.subject,
    count: r.count,
    status: r.status,
    closedBy: r.closedBy,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

export async function closeFault(kind: FaultKind, identifier: string, closedBy: string): Promise<boolean> {
  const rows = await db
    .update(daydreamFaults)
    .set({ status: 'closed', closedBy: closedBy.slice(0, 200), closedAt: new Date() })
    .where(and(eq(daydreamFaults.kind, kind), eq(daydreamFaults.identifier, identifier), eq(daydreamFaults.status, 'open')))
    .returning({ id: daydreamFaults.id });
  return rows.length > 0;
}

export async function faultCounts(): Promise<{ open: number; closed: number; declined: number; total: number; byWants: Record<string, number> }> {
  const rows = await db
    .select({ status: daydreamFaults.status, wants: daydreamFaults.wants, n: sql<number>`count(*)::int` })
    .from(daydreamFaults)
    .groupBy(daydreamFaults.status, daydreamFaults.wants);
  const out = { open: 0, closed: 0, declined: 0, total: 0, byWants: {} as Record<string, number> };
  for (const r of rows) {
    out.total += r.n;
    if (r.status === 'open') {
      out.open += r.n;
      out.byWants[r.wants] = (out.byWants[r.wants] ?? 0) + r.n;
    } else if (r.status === 'closed') out.closed += r.n;
    else if (r.status === 'declined') out.declined += r.n;
  }
  return out;
}

// ── Into self-improve ───────────────────────────────────────────────────
//
// Read by `selfimprove/analyze.ts` (that direction only — daydream never
// imports selfimprove). Each idea says the SHAPE in plain words, because the
// author prompt sees only title and detail, and the shape gate downstream
// (`sampleableTools`: no required args, numeric top-level fields) is silent.

export interface FaultIdea {
  title: string;
  detail: string;
  /** `feature` only for `code_change` — everything else is a runtime tool. */
  kind: 'tool' | 'feature';
  priority: number;
  evidence: string;
  faultKind: FaultKind;
  identifier: string;
}

function shapeSentence(wants: Wants): string {
  switch (wants) {
    case 'numeric_tool':
      return 'Build a runtime tool with NO required arguments that returns a plain object whose top-level fields are numbers (one reading of the measurement today). It is sampled once a day and becomes a daydream signal.';
    case 'reader_tool':
      return 'Build a runtime tool that takes one id and returns the row behind it as text — the reviewer already holds the ids and only lacks a reader.';
    case 'connector':
      return 'Find or register an API in the catalogue that serves this source, then build a no-argument runtime tool that reads one number a day from it.';
    case 'code_change':
      return 'This needs repo code — a node type migrated, a route, a schema change. It cannot be a runtime tool: open it as a change request so the autonomous builder implements it on a branch, runs the gate, and opens a PR.';
    default:
      return '';
  }
}

export async function collectFaultIdeas(limit = 5): Promise<FaultIdea[]> {
  const faults = await openFaults({ wants: BUILDABLE_WANTS, limit: 40 });
  const ideas: FaultIdea[] = [];
  for (const f of faults) {
    if (ideas.length >= limit) break;
    const shape = shapeSentence(f.wants);
    const title =
      f.wants === 'numeric_tool'
        ? `Source for the metric "${f.identifier}"`
        : f.wants === 'reader_tool'
          ? `Reader for ${f.identifier}`
          : f.wants === 'code_change'
            ? `Fix ${f.identifier}`
            : `Connector for ${f.identifier}`;
    ideas.push({
      title: title.slice(0, 200),
      detail: `${f.detail ?? f.kind} (raised ${f.count} time${f.count === 1 ? '' : 's'} by ${f.site}). ${shape}`.slice(0, 2000),
      kind: f.wants === 'code_change' ? 'feature' : 'tool',
      priority: f.count >= 3 ? 1 : 2,
      evidence: `daydream fault ${f.kind}:${f.identifier}, ${f.count}×, last ${f.lastSeenAt.slice(0, 10)}`,
      faultKind: f.kind,
      identifier: f.identifier,
    });
  }
  return ideas;
}

/** The needs `discoverApis` should search for: connectors and missing metrics. */
export async function faultNeeds(limit = 3): Promise<string[]> {
  const faults = await openFaults({ wants: ['connector', 'numeric_tool'], limit: 12 });
  return faults.slice(0, limit).map((f) => (f.wants === 'connector' ? `a data source for ${f.identifier}` : `a daily measurement of ${f.identifier}`));
}

// ── The return edge ─────────────────────────────────────────────────────

/**
 * A self-built tool signal that has become sweepable closes the metric
 * faults whose name it carries. Substring on key or label, case-insensitive:
 * no shared id exists between a metric name and a tool, and a fuzzy close
 * the next re-raise can reopen is cheaper than a wrong link that cannot.
 */
export async function closeFaultsForSignals(signals: Array<{ key: string; label: string }>): Promise<number> {
  if (!signals.length) return 0;
  const open = await openFaults({ wants: ['numeric_tool', 'connector'], limit: 100 });
  let closed = 0;
  for (const f of open) {
    const needle = f.identifier.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (needle.length < 4) continue;
    const hit = signals.find((s) => `${s.key} ${s.label}`.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(needle));
    if (hit && (await closeFault(f.kind, f.identifier, hit.key))) closed++;
  }
  return closed;
}
