/**
 * Which event-triggered schedules an event should start — pure, so the whole
 * matching matrix is testable without a database.
 *
 * A filter is deliberately small: a list of `{ key, op, value }` clauses over
 * the payload's TOP-LEVEL keys, all of which must hold. `equals` compares string
 * forms; `contains` is a case-insensitive substring test (and, on an array, "any
 * element contains"). That is enough for "whatsapp.inbound where text contains
 * 'lights'" and "gmail.inbound where from contains '@bank'", and small enough to
 * edit from a phone. Anything cleverer belongs in an `if` node after the trigger,
 * where it can see the whole payload and be tested on a run.
 */
import { canonicalEventType } from './catalogue';

export type FilterOp = 'equals' | 'contains';
export interface FilterClause {
  key: string;
  op: FilterOp;
  value: string;
}

const MAX_CLAUSES = 5;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Validate a filter from a request body. Absent or empty is "no filter". */
export function normaliseFilter(
  raw: unknown,
): { ok: true; filter: FilterClause[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, filter: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'filter must be a list of { key, op, value }' };
  const filter: FilterClause[] = [];
  for (const item of raw) {
    const c = (item ?? {}) as Record<string, unknown>;
    const key = typeof c.key === 'string' ? c.key.trim() : '';
    if (!key) continue;
    if (!KEY.test(key)) return { ok: false, error: `filter key "${key}" must be a top-level payload field` };
    const op = c.op === undefined ? 'equals' : c.op;
    if (op !== 'equals' && op !== 'contains') return { ok: false, error: `filter op must be equals or contains` };
    filter.push({ key, op, value: String(c.value ?? '').slice(0, 500) });
  }
  if (filter.length > MAX_CLAUSES) return { ok: false, error: `at most ${MAX_CLAUSES} filter clauses` };
  return { ok: true, filter };
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function matchesFilter(payload: Record<string, unknown> | undefined, filter: readonly FilterClause[]): boolean {
  const p = payload ?? {};
  return filter.every((c) => {
    if (!Object.prototype.hasOwnProperty.call(p, c.key)) return false;
    const v = p[c.key];
    const want = c.value.toLowerCase();
    if (c.op === 'equals') return asText(v).toLowerCase() === want;
    const values = Array.isArray(v) ? v : [v];
    return values.some((x) => asText(x).toLowerCase().includes(want));
  });
}

/** The part of a dispatched event a schedule is matched against. */
export interface MatchableEvent {
  type: string;
  payload?: Record<string, unknown>;
  chainDepth: number;
  /** The workflow whose run raised it, when one did. */
  originWorkflowId: string | null;
}

/**
 * Does the schedule `config` (owned by `scheduleWorkflowId`) fire on `event`?
 *
 * A workflow never starts off an event its own run raised — the generalised
 * form of the old "never trigger yourself off your own completion" rule, which
 * also stops a workflow triggered by `notification.raised` that itself notifies
 * from paging itself in a loop. Longer loops through other workflows are the
 * dispatcher's chain-depth limit.
 */
export function scheduleMatchesEvent(
  config: Record<string, unknown>,
  scheduleWorkflowId: string,
  event: MatchableEvent,
): boolean {
  if (typeof config.eventType !== 'string' || canonicalEventType(config.eventType) !== event.type) return false;
  if (event.originWorkflowId && event.originWorkflowId === scheduleWorkflowId) return false;
  const pinned = typeof config.sourceWorkflowId === 'string' ? config.sourceWorkflowId : '';
  if (pinned && event.payload?.workflowId !== pinned) return false;
  const parsed = normaliseFilter(config.filter);
  // A stored filter that no longer parses matches NOTHING: firing a workflow
  // on every event because its filter went bad is the dangerous direction.
  if (!parsed.ok) return false;
  return matchesFilter(event.payload, parsed.filter);
}
