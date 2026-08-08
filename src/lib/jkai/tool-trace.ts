// src/lib/jkai/tool-trace.ts
//
// Records the ordered chain of tool calls a single jkai turn made, so it can be
// stored once per turn and re-read later by the trace viewer (/jkai/trace/<id>).
//
// WHY THIS EXISTS. On the live Hermes engine the chain is not persisted anywhere:
// `handleWithHermes` writes five metadata keys onto the assistant row and none of
// them is `toolSteps`, and `job.toolSteps` — the field the retired in-process
// ReAct loop used — is never written on that branch. The chain therefore lives
// only in the browser tab that watched the turn happen, and vanishes on reload.
// A trace page that re-read the database would render nothing. So the recorder
// below observes the same `JobEvent`s the SSE stream publishes and accumulates a
// durable copy, exactly the way `turnAttachments` / `turnFileRefs` already
// accumulate their own per-turn side data in that function.
//
// WHAT IT ADDS over the live stream: server-side timestamps. The events carry no
// time of their own, so a step's duration and its position within the turn — the
// two things you actually want when decomposing a chain — do not exist anywhere
// today. The recorder stamps both.
//
// PURE MODULE. No DB, no SvelteKit, no `$app` imports: the chat route owns the
// write, and the tests drive `observe()` directly with a fake clock.

import type { JobEvent, DelegateChild } from '$lib/workflows/chat/job-store';
import { resolveDisplayTool, categorizeTool, type ToolCategory } from '$lib/workflows/chat/tool-summary';

/**
 * Size ceilings applied before anything reaches the jsonb column.
 *
 * A trace is forensic, so the rule everywhere is *mark, don't drop*: an
 * over-cap value is replaced by a node that says what was removed, rather than
 * silently shortened. A viewer that cannot distinguish "the tool returned this"
 * from "we stored this much of it" is worse than no viewer.
 *
 * `maxTotalBytes` is the backstop. The MCP bus hands us untruncated results —
 * a `web_extract` can be megabytes — and a turn can make hundreds of calls.
 */
export const TRACE_CAPS = {
  maxSteps: 300,
  maxString: 4_000,
  maxArray: 100,
  maxKeys: 60,
  maxDepth: 8,
  /** Per args/result payload. */
  maxValueBytes: 40_000,
  /** Whole serialised trace. Payloads are shed oldest-largest-first past this. */
  maxTotalBytes: 400_000,
} as const;

export interface TraceStep {
  /** 1-based position in the chain. */
  seq: number;
  toolCallId: string;
  /** Name as emitted (may be `mcp_jkai_jkai_extended`). */
  tool: string;
  /** Unmasked name the UI labels the row with. */
  displayTool: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  summary?: string;
  error?: string;
  /** Epoch ms, server clock. */
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** ms from the first observed event of the turn — places the row on a timeline. */
  offsetMs: number;
  argsTruncated?: boolean;
  resultTruncated?: boolean;
  /** Byte size of the payloads BEFORE capping, so the viewer can be honest. */
  argsBytes?: number;
  resultBytes?: number;
  /** Set when the payload was shed entirely to keep the trace under budget. */
  payloadShed?: boolean;
  /** The tool returned its result as a JSON string, which we parsed before
   *  storing. Recorded so the viewer can say so rather than quietly implying
   *  the tool returned an object. */
  resultJsonString?: boolean;
  /** The result is a string that opens like JSON but does not parse — i.e. it
   *  was cut off before it ever reached us. Hermes previews native tool results
   *  at 600 chars (`adapter.py` `_preview_tool_value`), so this is the normal
   *  state of a large `web_extract`. Flagged because an unexplained half-object
   *  reads as a broken tool rather than an upstream preview limit. */
  resultClipped?: boolean;
  /** Sub-agent summary rows parsed adapter-side from a `delegate_task` result. */
  children?: DelegateChild[];
  /** Ephemeral-tool sidecar, lifted out of `result.data.__ephemeral__` BEFORE
   *  capping and stored verbatim. `promote_ephemeral_tool` compiles this
   *  handler source, so a truncated copy is not merely degraded — it is
   *  unusable. */
  ephemeral?: EphemeralSidecar;
  /** Chart/map/table artifact, lifted out of `result.data.artifact` BEFORE
   *  capping and stored verbatim. This is user-visible content the chat
   *  re-renders, not diagnostics: capping an array of data points at 100 would
   *  silently redraw the chart with the wrong shape. */
  artifact?: unknown;
}

/** Mirrors `$lib/workflows/chat/ephemeral-sidecar` — duplicated as a type only
 *  so this module stays free of server imports. */
export interface EphemeralSidecar {
  handlerCode: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  proposedName?: string;
  proposedDescription?: string;
}

/**
 * The shape the chat persists on the assistant message so a reloaded thread can
 * rebuild its step cards. Matches what `ChatArea` hydrates from
 * `metadata.toolSteps` and what `promote_ephemeral_tool` looks up server-side.
 */
export interface CompactToolStep {
  /** Both keys are set on purpose: the client matches on `id`, the legacy
   *  writer set only `toolCallId`, and `promote_ephemeral_tool` tries `id`
   *  first then falls back to the tool name. Setting both ends a long-standing
   *  mismatch between the two shapes. */
  id: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  summary?: string;
  children?: DelegateChild[];
  ephemeral?: EphemeralSidecar;
}

export interface TraceSubAgentStep {
  tool: string;
  displayTool: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  summary?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

export interface TraceSubAgent {
  agentId: string;
  parentStepId: string | null;
  task: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  result?: unknown;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  steps: TraceSubAgentStep[];
}

export interface ToolTrace {
  version: 1;
  steps: TraceStep[];
  subAgents: TraceSubAgent[];
  stepCount: number;
  errorCount: number;
  /** Steps seen after `maxSteps` — recorded as a count so the page can say so. */
  droppedSteps: number;
  /** Payloads removed to fit `maxTotalBytes`. */
  payloadsDropped: number;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

export interface TraceRecorder {
  /** Feed every JobEvent the turn publishes. Non-tool events are ignored. */
  observe(ev: JobEvent): void;
  /** Capped, JSON-safe snapshot. Safe to call more than once. */
  snapshot(): ToolTrace;
  hasSteps(): boolean;
}

/* -------------------------------------------------------------------------- */
/* Deep capping                                                                */
/* -------------------------------------------------------------------------- */

/** Marker node for a value we deliberately did not store in full. */
type TruncationMarker = Record<string, unknown>;

/**
 * Walk a value, shortening long strings / big arrays / wide objects in place and
 * flagging each edit. Preserves shape wherever it can — the viewer table-ifies
 * uniform arrays of objects, and a blanket "replace the whole payload with a
 * string" cap would destroy that.
 *
 * `byteBudget` is a second, coarser pass: some payloads are large because they
 * are *broad* (hundreds of medium keys) rather than deep, and survive the
 * per-leaf caps while still being far too big.
 */
export function capDeep(
  value: unknown,
  byteBudget: number = TRACE_CAPS.maxValueBytes,
): { value: unknown; truncated: boolean; bytes: number } {
  let truncated = false;
  const seen = new WeakSet<object>();

  function walk(v: unknown, depth: number): unknown {
    if (v === null || v === undefined) return v;

    const t = typeof v;
    if (t === 'string') {
      const s = v as string;
      if (s.length > TRACE_CAPS.maxString) {
        truncated = true;
        return `${s.slice(0, TRACE_CAPS.maxString)}… [+${s.length - TRACE_CAPS.maxString} chars]`;
      }
      return s;
    }
    if (t === 'number' || t === 'boolean') return v;
    if (t === 'bigint') return String(v);
    if (t === 'function' || t === 'symbol') {
      truncated = true;
      return `[${t}]`;
    }

    if (depth >= TRACE_CAPS.maxDepth) {
      truncated = true;
      return { __depth_capped__: true };
    }

    const obj = v as object;
    if (seen.has(obj)) {
      truncated = true;
      return { __circular__: true };
    }
    seen.add(obj);

    try {
      if (Array.isArray(v)) {
        const arr = v as unknown[];
        const keep = arr.slice(0, TRACE_CAPS.maxArray).map((el) => walk(el, depth + 1));
        if (arr.length > TRACE_CAPS.maxArray) {
          truncated = true;
          keep.push({ __truncated__: true, omitted: arr.length - TRACE_CAPS.maxArray } as TruncationMarker);
        }
        return keep;
      }

      // Date and other well-known wrappers serialise fine; let them through as-is.
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Error) return { name: v.name, message: walk(v.message, depth + 1) };

      const entries = Object.entries(v as Record<string, unknown>);
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries.slice(0, TRACE_CAPS.maxKeys)) {
        out[k] = walk(val, depth + 1);
      }
      if (entries.length > TRACE_CAPS.maxKeys) {
        truncated = true;
        out.__truncated__ = { omittedKeys: entries.length - TRACE_CAPS.maxKeys };
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }

  const capped = walk(value, 0);
  let bytes = safeByteLength(capped);

  // Broad-but-shallow payloads can clear every per-leaf cap and still be huge.
  if (bytes > byteBudget) {
    truncated = true;
    const preview = safeStringify(capped).slice(0, Math.max(0, byteBudget - 256));
    const replaced = {
      __truncated__: true,
      reason: 'value exceeded the per-payload byte budget',
      bytes,
      preview,
    };
    bytes = safeByteLength(replaced);
    return { value: replaced, truncated, bytes };
  }

  return { value: capped, truncated, bytes };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/** Serialised length of a value, or 0 when it cannot be serialised at all. */
function safeByteLength(v: unknown): number {
  return safeStringify(v).length;
}

/**
 * Several tools hand back their payload as a JSON *string* rather than an
 * object — Hermes' `web_extract` is the common one. Parse it before capping,
 * never after: capping a 22 KB JSON string truncates it mid-structure, and what
 * is left is neither valid JSON nor readable text. Parsing first means the caps
 * apply to the real shape, the viewer can table-ify it, and the truncation
 * markers land on individual fields instead of guillotining the whole payload.
 */
export function coerceJsonString(value: unknown): { value: unknown; wasJsonString: boolean; clipped: boolean } {
  if (typeof value !== 'string') return { value, wasJsonString: false, clipped: false };
  const t = value.trim();
  if (t.length < 2 || !/^[[{]/.test(t)) return { value, wasJsonString: false, clipped: false };
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object') return { value: parsed, wasJsonString: true, clipped: false };
  } catch {
    // Opens like JSON but does not close: something upstream cut it short.
    // Keep the fragment verbatim — it is still the best evidence available —
    // but say so, rather than letting it read as a malformed tool response.
    return { value, wasJsonString: false, clipped: true };
  }
  return { value, wasJsonString: false, clipped: false };
}

/** Ceiling for the two payloads exempted from deep capping. Generous, because
 *  both are content rather than diagnostics, but not unbounded. */
const PROTECTED_MAX_BYTES = 200_000;

/**
 * Pull the payloads that must survive verbatim out of a tool result, and hand
 * back the remainder for normal capping.
 *
 * Two of them, for the same underlying reason — they are re-used, not just
 * read. `__ephemeral__.handlerCode` gets compiled by `promote_ephemeral_tool`,
 * and `artifact` gets re-rendered as a chart/map/table in the chat. A capped
 * copy of either is worse than none: it looks intact and behaves wrongly.
 *
 * `__ephemeral__` is additionally *removed* from the result (mirroring
 * `extractEphemeralSidecar`), so the sidecar does not also sit inside the
 * result the model sees when history is rehydrated.
 */
function liftProtectedPayloads(result: unknown): {
  rest: unknown;
  ephemeral?: EphemeralSidecar;
  artifact?: unknown;
} {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { rest: result };
  const r = result as Record<string, unknown>;
  const data = r.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { rest: result };

  const d = data as Record<string, unknown>;
  const rawSidecar = d.__ephemeral__;
  const rawArtifact = d.artifact;
  if (rawSidecar === undefined && rawArtifact === undefined) return { rest: result };

  const { __ephemeral__: _drop, ...cleanedData } = d;
  void _drop;

  const withinBudget = (v: unknown) => v !== undefined && rawByteLength(v) <= PROTECTED_MAX_BYTES;

  return {
    rest: { ...r, data: cleanedData },
    ephemeral: withinBudget(rawSidecar) ? (rawSidecar as EphemeralSidecar) : undefined,
    artifact: withinBudget(rawArtifact) ? rawArtifact : undefined,
  };
}

/** Original size of a payload, measured before capping, for the viewer's benefit. */
function rawByteLength(v: unknown): number {
  if (v === undefined) return 0;
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    // Circular or otherwise unserialisable — the capped copy will report its own size.
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Table-ification helper (shared with the viewer)                             */
/* -------------------------------------------------------------------------- */

/**
 * Is this value an array of like-shaped flat records — i.e. worth rendering as a
 * real table rather than as JSON?
 *
 * Deliberately strict. A table of one row adds nothing over the JSON, and rows
 * whose cells are themselves objects produce a table of `[object Object]`, which
 * is worse than the JSON it replaced. Two rows sharing most of their keys, with
 * scalar-ish cells, is the case that genuinely reads better as a grid — and that
 * is the shape most jkai tool results come back in (`data.hits`, `data.messages`,
 * `data.files`, `data.memories`).
 */
export function isUniformRows(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;

  const rows = value.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
  if (rows.length !== value.length) return false;
  if (rows.length > TRACE_CAPS.maxArray + 1) return false;

  // Every cell must be renderable in a table cell.
  for (const row of rows) {
    for (const cell of Object.values(row)) {
      if (cell === null || cell === undefined) continue;
      const t = typeof cell;
      if (t === 'string' || t === 'number' || t === 'boolean') continue;
      if (Array.isArray(cell)) {
        // An array of scalars is fine (renders joined); an array of objects is not.
        if (cell.every((c) => c === null || ['string', 'number', 'boolean'].includes(typeof c))) continue;
        return false;
      }
      if (t === 'object') {
        // One level of nesting renders as a compact JSON cell; deeper does not.
        const inner = Object.values(cell as Record<string, unknown>);
        if (inner.every((c) => c === null || ['string', 'number', 'boolean'].includes(typeof c))) continue;
        return false;
      }
      return false;
    }
  }

  // Shapes must actually agree: the commonest key set should cover most rows.
  const first = new Set(Object.keys(rows[0]));
  if (first.size === 0) return false;
  let shared = 0;
  for (const row of rows) {
    const keys = Object.keys(row);
    const overlap = keys.filter((k) => first.has(k)).length;
    if (overlap / Math.max(first.size, keys.length) >= 0.5) shared++;
  }
  return shared === rows.length;
}

/** Column order for a uniform-row table: first-seen order across all rows. */
export function unionColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

/* -------------------------------------------------------------------------- */
/* Compact projection for the message row                                      */
/* -------------------------------------------------------------------------- */

/** Per-message ceiling for the compact steps written to `metadata.toolSteps`.
 *  The conversation loader selects `metadata` for EVERY message in a thread, so
 *  this is multiplied by thread length on every thread switch. */
const COMPACT_TOTAL_BYTES = 64_000;
/** Per-result ceiling inside a compact step. The inline disclosure is a glance;
 *  the trace page holds the full payload. */
const COMPACT_RESULT_BYTES = 4_000;

/**
 * Project a recorded chain into the small form the chat stores on the assistant
 * message, so a reloaded thread can rebuild its step cards.
 *
 * WHY BOTH STORES EXIST. They answer different questions and are sized for
 * different readers. `metadata.toolSteps` is read on every thread load and only
 * has to render a one-line card plus a glance at the payload. `jkai_tool_traces`
 * is read when someone deliberately opens one turn to study it, and keeps the
 * full chain, timings and untruncated payloads. Storing the full chain in both
 * would multiply the heaviest data by thread length on every conversation
 * switch; storing only the compact form would make the trace page pointless.
 *
 * `artifact` and `ephemeral` are re-attached verbatim regardless of the result
 * budget — the chat re-renders the first and compiles the second.
 */
export function compactStepsForMessage(trace: ToolTrace): CompactToolStep[] {
  const out: CompactToolStep[] = [];
  let spent = 0;

  for (const step of trace.steps) {
    // The tool name and args are already un-masked (jkai_extended unwrapped,
    // mcp_ prefix stripped) — which is exactly what the UI expects to find in
    // this field, so `resolveDisplayTool` on the client is a no-op.
    const compact: CompactToolStep = {
      id: step.toolCallId,
      toolCallId: step.toolCallId,
      tool: step.displayTool,
      args: {},
      status: step.status,
      summary: step.summary,
    };
    if (step.children?.length) compact.children = step.children;
    if (step.ephemeral) compact.ephemeral = step.ephemeral;

    const argsCap = capDeep(step.args, COMPACT_RESULT_BYTES);
    compact.args = (argsCap.value ?? {}) as Record<string, unknown>;

    if (step.result !== undefined) {
      const resCap = capDeep(step.result, COMPACT_RESULT_BYTES);
      compact.result = resCap.value;
    }

    // Re-attach the artifact into the shape `artifactsForMessage` reads:
    // `step.result.data.artifact`.
    if (step.artifact !== undefined) {
      const base =
        compact.result && typeof compact.result === 'object' && !Array.isArray(compact.result)
          ? (compact.result as Record<string, unknown>)
          : {};
      const baseData =
        base.data && typeof base.data === 'object' && !Array.isArray(base.data)
          ? (base.data as Record<string, unknown>)
          : {};
      compact.result = { ...base, data: { ...baseData, artifact: step.artifact } };
    }

    const size = safeByteLength(compact);
    if (spent + size > COMPACT_TOTAL_BYTES && out.length > 0) {
      // Over budget: keep the card (tool, status, summary stay useful) but drop
      // the payload, unless it carries content the chat has to re-render.
      if (step.artifact === undefined && !step.ephemeral) {
        compact.result = undefined;
        compact.args = {};
      }
    }
    spent += safeByteLength(compact);
    out.push(compact);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Recorder                                                                    */
/* -------------------------------------------------------------------------- */

interface PendingStep extends TraceStep {
  /** Uncapped payloads, capped once at snapshot time. */
  _rawArgs: Record<string, unknown>;
  _rawResult?: unknown;
  _hasResult: boolean;
}

/**
 * Pull a human-readable error out of a failed tool result. The two producers
 * disagree: the MCP bus wraps a failure as `{ error }` (chat `+server.ts`), while
 * a site-tool handler returns the `{ success:false, error }` envelope.
 */
function errorTextOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return typeof result === 'string' ? result : undefined;
  const r = result as { error?: unknown; message?: unknown };
  if (typeof r.error === 'string' && r.error) return r.error;
  if (typeof r.message === 'string' && r.message) return r.message;
  return undefined;
}

export function createTraceRecorder(opts: { now?: () => number } = {}): TraceRecorder {
  const now = opts.now ?? Date.now;

  const steps: PendingStep[] = [];
  const byCallId = new Map<string, PendingStep>();
  const subAgents: TraceSubAgent[] = [];
  const subById = new Map<string, TraceSubAgent>();

  let seq = 0;
  let dropped = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let synthCounter = 0;

  function stamp(): number {
    const t = now();
    if (firstAt === null) firstAt = t;
    lastAt = t;
    return t;
  }

  function startStep(tool: string, args: Record<string, unknown>, toolCallId: string | undefined, summary: string | undefined): PendingStep | null {
    const t = stamp();
    if (steps.length >= TRACE_CAPS.maxSteps) {
      dropped++;
      return null;
    }
    const disp = resolveDisplayTool(tool, args);
    const id = toolCallId || `synth-${++synthCounter}`;
    const step: PendingStep = {
      seq: ++seq,
      toolCallId: id,
      tool,
      displayTool: disp.tool,
      category: categorizeTool(disp.tool),
      args: {},
      status: 'running',
      summary,
      startedAt: t,
      offsetMs: firstAt === null ? 0 : t - firstAt,
      _rawArgs: disp.args,
      _hasResult: false,
    };
    steps.push(step);
    byCallId.set(id, step);
    return step;
  }

  /**
   * Find the step a `tool_result` closes. By id first — ChatArea learned the hard
   * way that name-only matching swaps results between concurrent same-named calls
   * (many parallel `web_search`). Name matching survives only as the fallback for
   * producers that emit no id, and then only against the newest *running* step.
   */
  function findOpenStep(tool: string, toolCallId: string | undefined): PendingStep | undefined {
    if (toolCallId) {
      const byId = byCallId.get(toolCallId);
      if (byId) return byId;
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].tool === tool && steps[i].status === 'running') return steps[i];
    }
    return undefined;
  }

  function finishStep(tool: string, toolCallId: string | undefined, result: unknown, status: 'done' | 'error', summary: string | undefined, children: DelegateChild[] | undefined) {
    const t = stamp();
    let step = findOpenStep(tool, toolCallId);
    if (!step) {
      // A result with no start — record it rather than lose the call.
      step = startStep(tool, {}, toolCallId, summary) ?? undefined;
      if (!step) return;
    }
    step.status = status;
    step._rawResult = result;
    step._hasResult = true;
    step.endedAt = t;
    step.durationMs = t - step.startedAt;
    if (summary) step.summary = summary;
    if (children?.length) step.children = children;
    if (status === 'error') step.error = errorTextOf(result);
  }

  function ensureSubAgent(agentId: string, parentStepId: string | null, task: string): TraceSubAgent {
    let sub = subById.get(agentId);
    if (!sub) {
      sub = {
        agentId,
        parentStepId,
        task,
        status: 'running',
        startedAt: stamp(),
        steps: [],
      };
      subAgents.push(sub);
      subById.set(agentId, sub);
    }
    return sub;
  }

  function observeSubAgentInner(sub: TraceSubAgent, inner: JobEvent) {
    if (inner.type === 'tool_start') {
      const disp = resolveDisplayTool(inner.tool, inner.args);
      sub.steps.push({
        tool: inner.tool,
        displayTool: disp.tool,
        category: categorizeTool(disp.tool),
        args: disp.args,
        status: 'running',
        summary: inner.summary,
        startedAt: stamp(),
      });
      return;
    }
    if (inner.type === 'tool_result') {
      const t = stamp();
      // Sub-agent frames carry no toolCallId (sse-adapter.ts) — newest running
      // step of that name is the only correlation available.
      for (let i = sub.steps.length - 1; i >= 0; i--) {
        const s = sub.steps[i];
        if (s.tool === inner.tool && s.status === 'running') {
          s.status = inner.status;
          s.result = inner.result;
          s.endedAt = t;
          s.durationMs = t - s.startedAt;
          if (inner.summary) s.summary = inner.summary;
          return;
        }
      }
      const disp = resolveDisplayTool(inner.tool, {});
      sub.steps.push({
        tool: inner.tool,
        displayTool: disp.tool,
        category: categorizeTool(disp.tool),
        args: {},
        result: inner.result,
        status: inner.status,
        summary: inner.summary,
        startedAt: t,
        endedAt: t,
        durationMs: 0,
      });
    }
  }

  return {
    observe(ev: JobEvent) {
      switch (ev.type) {
        case 'tool_start':
          startStep(ev.tool, ev.args ?? {}, ev.toolCallId, ev.summary);
          return;
        case 'tool_result':
          finishStep(ev.tool, ev.toolCallId, ev.result, ev.status, ev.summary, ev.children);
          return;
        case 'subagent_start':
          ensureSubAgent(ev.agentId, ev.parentStepId, ev.task);
          return;
        case 'subagent_event': {
          const sub = ensureSubAgent(ev.agentId, null, '');
          observeSubAgentInner(sub, ev.event);
          return;
        }
        case 'subagent_done': {
          const sub = ensureSubAgent(ev.agentId, null, '');
          sub.status = 'done';
          sub.summary = ev.summary;
          sub.result = ev.result;
          sub.endedAt = stamp();
          sub.durationMs = sub.endedAt - sub.startedAt;
          for (const s of sub.steps) if (s.status === 'running') s.status = 'done';
          return;
        }
        default:
          // Every other JobEvent (token, status, heartbeat, plan, confirm,
          // clarify, secret_request, approval, done, error…) is not tool
          // activity. Ignored on purpose.
          return;
      }
    },

    hasSteps() {
      return steps.length > 0 || subAgents.length > 0;
    },

    snapshot(): ToolTrace {
      let payloadsDropped = 0;

      const out: TraceStep[] = steps.map((s) => {
        const argsCap = capDeep(s._rawArgs);
        const step: TraceStep = {
          seq: s.seq,
          toolCallId: s.toolCallId,
          tool: s.tool,
          displayTool: s.displayTool,
          category: s.category,
          args: (argsCap.value ?? {}) as Record<string, unknown>,
          status: s.status,
          summary: s.summary,
          error: s.error,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMs: s.durationMs,
          offsetMs: firstAt === null ? 0 : s.startedAt - firstAt,
          argsBytes: rawByteLength(s._rawArgs),
          children: s.children,
        };
        if (argsCap.truncated) step.argsTruncated = true;
        if (s._hasResult) {
          const coerced = coerceJsonString(s._rawResult);
          const lifted = liftProtectedPayloads(coerced.value);
          if (lifted.ephemeral) step.ephemeral = lifted.ephemeral;
          if (lifted.artifact !== undefined) step.artifact = lifted.artifact;
          const resCap = capDeep(lifted.rest);
          step.result = resCap.value;
          // Size is reported against what the tool actually sent, not the
          // parsed form, so "22 KB" matches what crossed the wire.
          step.resultBytes = rawByteLength(s._rawResult);
          if (resCap.truncated) step.resultTruncated = true;
          if (coerced.wasJsonString) step.resultJsonString = true;
          if (coerced.clipped) step.resultClipped = true;
        }
        return step;
      });

      const cappedSubAgents: TraceSubAgent[] = subAgents.map((sub) => ({
        ...sub,
        result: sub.result === undefined ? undefined : capDeep(sub.result).value,
        steps: sub.steps.map((s) => ({
          ...s,
          args: (capDeep(s.args).value ?? {}) as Record<string, unknown>,
          result: s.result === undefined ? undefined : capDeep(s.result).value,
        })),
      }));

      const trace: ToolTrace = {
        version: 1,
        steps: out,
        subAgents: cappedSubAgents,
        stepCount: out.length,
        errorCount: out.filter((s) => s.status === 'error').length,
        droppedSteps: dropped,
        payloadsDropped: 0,
        startedAt: firstAt,
        endedAt: lastAt,
        durationMs: firstAt !== null && lastAt !== null ? lastAt - firstAt : null,
      };

      // Total-size backstop. Shed the biggest payloads first, keeping every
      // step's metadata — a chain of 300 rows with "payload too large" beats a
      // truncated chain that silently stops at row 40.
      if (safeByteLength(trace) > TRACE_CAPS.maxTotalBytes) {
        const bySize = [...out].sort(
          (a, b) => (b.resultBytes ?? 0) + (b.argsBytes ?? 0) - ((a.resultBytes ?? 0) + (a.argsBytes ?? 0)),
        );
        for (const step of bySize) {
          if (safeByteLength(trace) <= TRACE_CAPS.maxTotalBytes) break;
          if (step.result === undefined && Object.keys(step.args).length === 0) continue;
          step.result = step.result === undefined ? undefined : { __truncated__: true, reason: 'trace size budget' };
          step.args = {};
          step.payloadShed = true;
          payloadsDropped++;
        }
        // Sub-agent payloads are the next-largest thing after step payloads.
        if (safeByteLength(trace) > TRACE_CAPS.maxTotalBytes) {
          for (const sub of trace.subAgents) {
            sub.result = undefined;
            for (const s of sub.steps) {
              s.args = {};
              s.result = undefined;
            }
          }
        }
        trace.payloadsDropped = payloadsDropped;
      }

      return trace;
    },
  };
}
