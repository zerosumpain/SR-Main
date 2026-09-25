import { Cron } from 'croner';
import { eventEntry } from '$lib/events/catalogue';
import { normaliseFilter, type FilterClause } from '$lib/events/filter';
import type { BasicConfigField, JsonSchema, NodeDefinition } from '$lib/workflows/types';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { DEFAULT_CRON_TZ } from '$lib/workflows/cron-timezone';
import { describeCron } from '$lib/workflows/cron-describe';

export { describeCron };

/**
 * The iPhone's view of a canvas workflow — contract v1 of
 * `/api/native/workflows`. Pure: no database, no registry. The loaders in
 * `./workflows.server.ts` fetch rows and hand them here, so every decision the
 * phone sees (step order, what needs attention, what a form looks like) is a
 * function a unit test can call.
 *
 * Shapes are camelCase with ISO dates; the app decodes nothing else.
 */

// ———————————————————————————————————————————— forms

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'template'
  | 'number'
  | 'toggle'
  | 'dropdown'
  | 'code'
  | 'json'
  | 'phone'
  | 'chips';

export interface FieldDTO {
  key: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  advanced: boolean;
  section?: string;
}

/**
 * The key of the single fallback field that edits the WHOLE config as JSON,
 * for a node with neither `basicConfig` nor schema properties.
 */
export const WHOLE_CONFIG_KEY = '$config';

/**
 * The web's BasicConfigForm widget → the phone's control.
 *
 * `slider` becomes a number with its bounds; a phone stepper is the better
 * control and the bounds survive. `schema-builder` and `key-value-table` are
 * structured editors with no phone counterpart, so they fall to raw JSON —
 * editable, not pretty. A dropdown whose options are resolved at render time
 * on the web (`dynamicOptionsKey`: model lists, scraper profiles) arrives with
 * no options, so it is sent as text rather than as a picker with nothing in it.
 */
export function fieldFromBasic(field: BasicConfigField): FieldDTO {
  const out: FieldDTO = {
    key: field.key,
    label: field.label,
    kind: 'text',
    advanced: field.advancedOnly === true,
  };
  switch (field.type) {
    case 'dropdown':
      if (field.options && field.options.length > 0) {
        out.kind = 'dropdown';
        out.options = field.options.map((o) => ({ value: String(o.value), label: o.label }));
      } else {
        out.kind = 'text';
      }
      break;
    case 'toggle':
      out.kind = 'toggle';
      break;
    case 'slider':
    case 'number':
      out.kind = 'number';
      break;
    case 'text':
      out.kind = 'text';
      break;
    case 'textarea':
      out.kind = 'textarea';
      break;
    case 'template-textarea':
      out.kind = 'template';
      break;
    case 'code':
      out.kind = 'code';
      break;
    case 'chip-input':
      out.kind = 'chips';
      break;
    case 'phone':
      out.kind = 'phone';
      break;
    case 'schema-builder':
    case 'key-value-table':
    default:
      out.kind = 'json';
  }
  if (typeof field.min === 'number') out.min = field.min;
  if (typeof field.max === 'number') out.max = field.max;
  if (typeof field.step === 'number') out.step = field.step;
  if (field.placeholder) out.placeholder = field.placeholder;
  if (field.description) out.help = field.description;
  if (field.section) out.section = field.section;
  return out;
}

function humaniseKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

const PROSE_KEY = /(prompt|message|body|template|content|instructions|text)$/i;

/** One JSON Schema property → a field, for nodes with no `basicConfig`. */
export function fieldFromSchema(key: string, schema: JsonSchema): FieldDTO {
  const out: FieldDTO = {
    key,
    label: typeof schema.title === 'string' && schema.title ? schema.title : humaniseKey(key),
    kind: 'json',
    advanced: false,
  };
  if (typeof schema.description === 'string' && schema.description) out.help = schema.description;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : null;

  if (enumValues && enumValues.length > 0 && enumValues.every((v) => typeof v === 'string' || typeof v === 'number')) {
    out.kind = 'dropdown';
    out.options = enumValues.map((v) => ({ value: String(v), label: String(v) }));
  } else if (type === 'string') {
    // A schema says "string" for a URL and for a 2,000-word prompt alike; the
    // key is the only hint which one a phone should give a multi-line box.
    out.kind = PROSE_KEY.test(key) ? 'textarea' : 'text';
  } else if (type === 'number' || type === 'integer') {
    out.kind = 'number';
    if (typeof schema.minimum === 'number') out.min = schema.minimum;
    if (typeof schema.maximum === 'number') out.max = schema.maximum;
    if (type === 'integer') out.step = 1;
  } else if (type === 'boolean') {
    out.kind = 'toggle';
  } else if (type === 'array' && schema.items && (schema.items as JsonSchema).type === 'string') {
    out.kind = 'chips';
  }
  return out;
}

/**
 * The form for a node type: its `basicConfig` when it has one (the same fields
 * the web's BasicConfigForm renders, in the same order), else one field per
 * `configSchema` property, else a single JSON editor over the whole config.
 *
 * Keys starting `_` (the universal `_onError` block) are engine plumbing, not
 * settings, and stay out of a schema-derived form.
 */
export function deriveFormFields(def: Pick<NodeDefinition, 'basicConfig' | 'configSchema'> | undefined): FieldDTO[] {
  if (def?.basicConfig && def.basicConfig.length > 0) {
    return def.basicConfig.map(fieldFromBasic);
  }
  const props = def?.configSchema?.properties;
  if (props && Object.keys(props).length > 0) {
    return Object.entries(props)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, schema]) => fieldFromSchema(key, schema ?? {}));
  }
  return [{ key: WHOLE_CONFIG_KEY, label: 'Configuration', kind: 'json', advanced: false }];
}

// ———————————————————————————————————————————— steps and order

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  position: unknown;
  version?: number | null;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
}

/** Node types that START a run. The phone shows these first. */
export const ENTRY_NODE_TYPES: ReadonlySet<string> = new Set([
  'trigger',
  'manual-trigger',
  'whatsapp-trigger',
  'gmail-trigger',
]);

function pos(n: GraphNode): { x: number; y: number } {
  const p = (n.position ?? {}) as { x?: unknown; y?: unknown };
  return { x: typeof p.x === 'number' ? p.x : 0, y: typeof p.y === 'number' ? p.y : 0 };
}

/**
 * Is this node a STEP — something that runs?
 *
 * Display-only nodes (post-its, annotation boxes, stats panels) never join the
 * DAG. An unwired `chat` node is the canvas's orchestrator panel, which every
 * canvas is born with (`createCanvas`); it becomes a step only once wired in.
 */
export function isStepNode(node: GraphNode, edges: GraphEdge[]): boolean {
  if (isDisplayOnlyType(node.type)) return false;
  if (node.type === 'chat') {
    return edges.some((e) => e.sourceNodeId === node.id || e.targetNodeId === node.id);
  }
  return true;
}

/**
 * Steps in the order they run: entry nodes first, then a topological walk.
 *
 * Among nodes that are ready at the same moment (siblings on two branches),
 * the one higher on the canvas comes first, then the one further left — the
 * order a person reading the canvas would give. A cycle cannot be walked, so
 * whatever it strands is appended in that same reading order rather than
 * dropped: a list the phone shows must contain every step.
 */
export function orderSteps(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byReading = (a: GraphNode, b: GraphNode) => {
    const pa = pos(a);
    const pb = pos(b);
    return pa.y - pb.y || pa.x - pb.x || a.id.localeCompare(b.id);
  };
  const ids = new Set(nodes.map((n) => n.id));
  const entries = nodes.filter((n) => ENTRY_NODE_TYPES.has(n.type)).sort(byReading);
  const placed = new Set(entries.map((n) => n.id));
  const rest = nodes.filter((n) => !placed.has(n.id));

  const indegree = new Map<string, number>(rest.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.sourceNodeId) || !ids.has(e.targetNodeId)) continue;
    if (!outgoing.has(e.sourceNodeId)) outgoing.set(e.sourceNodeId, []);
    outgoing.get(e.sourceNodeId)!.push(e.targetNodeId);
    // An edge out of an entry node is already satisfied — the entry is placed.
    if (indegree.has(e.targetNodeId) && !placed.has(e.sourceNodeId)) {
      indegree.set(e.targetNodeId, (indegree.get(e.targetNodeId) ?? 0) + 1);
    }
  }

  const byId = new Map(rest.map((n) => [n.id, n]));
  const ordered: GraphNode[] = [...entries];
  let ready = rest.filter((n) => indegree.get(n.id) === 0);
  while (ready.length > 0) {
    ready.sort(byReading);
    const next = ready.shift()!;
    ordered.push(next);
    placed.add(next.id);
    for (const target of outgoing.get(next.id) ?? []) {
      if (!indegree.has(target) || placed.has(target)) continue;
      const left = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, left);
      if (left === 0) ready.push(byId.get(target)!);
    }
  }
  const stranded = rest.filter((n) => !placed.has(n.id)).sort(byReading);
  return [...ordered, ...stranded];
}

/**
 * A number that changes whenever the graph does — the `version` the phone
 * sends back as `expectedVersion`.
 *
 * `workflows` has no version column; nodes do (bumped on every config write)
 * and edges have ids. Hashing the set of `node id:version` and edge ids moves
 * on every add, remove, rewire and edit, and on nothing else. FNV-1a to a
 * positive 31-bit integer so it survives any JSON number decoder. Equality is
 * all it promises — it is not monotonic.
 */
export function graphVersion(
  nodes: Array<Pick<GraphNode, 'id' | 'version'>>,
  edges: Array<Pick<GraphEdge, 'id'>>,
): number {
  const parts = [
    ...nodes.map((n) => `n:${n.id}:${n.version ?? 0}`).sort(),
    ...edges.map((e) => `e:${e.id}`).sort(),
  ];
  let hash = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}

// ———————————————————————————————————————————— runs

export interface RunRow {
  id: string;
  status: string;
  trigger: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  mode?: string | null;
}

export interface RunSummaryDTO {
  id: string;
  status: string;
  trigger: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  /** 'test' = a test run (pins applied, side effects stubbed); else 'live'. */
  mode: 'live' | 'test';
}

export function runSummary(row: RunRow): RunSummaryDTO {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    durationMs:
      row.startedAt && row.completedAt ? row.completedAt.getTime() - row.startedAt.getTime() : null,
    error: row.error ?? null,
    mode: row.mode === 'test' ? 'test' : 'live',
  };
}

export const OUTPUT_PREVIEW_LIMIT = 4096;

/** Pretty JSON for a step's output, clipped to 4 KB. Null when there is none. */
export function outputPreview(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  let text: string;
  try {
    text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  } catch {
    return null;
  }
  if (text === undefined) return null;
  if (text.length <= OUTPUT_PREVIEW_LIMIT) return text;
  return `${text.slice(0, OUTPUT_PREVIEW_LIMIT)}\n… (truncated)`;
}

/**
 * How many rows a step produced, where the stored output says. The engine
 * emits a row count live but does not persist it, so this reads what the
 * record itself shows: an array output's length, or a `_rowCount` if present.
 */
export function outputRows(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  if (output && typeof output === 'object') {
    const rc = (output as Record<string, unknown>)._rowCount;
    if (typeof rc === 'number' && Number.isFinite(rc)) return rc;
  }
  return null;
}

// ———————————————————————————————————————————— attention

export interface AttentionInput {
  lastRun: Pick<RunRow, 'status' | 'error'> | null;
  buildError: string | null;
  question?: string | null;
  pendingFixes?: number;
}

function firstLine(text: string, max = 140): string {
  const line = text.split('\n').find((l) => l.trim()) ?? text;
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Whether a workflow needs the owner, and why, in one sentence.
 *
 * Only states the owner can act on: a build that failed or asked a question, a run that failed or
 * half-failed, a run paused for an approval, a fix waiting to be accepted. A
 * run in progress, or a workflow that has never run, is not a problem.
 */
export function attentionFor(input: AttentionInput): { needsAttention: boolean; attentionReason: string | null } {
  if (input.question) return { needsAttention: true, attentionReason: 'jkai has a question' };
  if (input.buildError) {
    return { needsAttention: true, attentionReason: firstLine(input.buildError) };
  }
  const run = input.lastRun;
  if (run?.status === 'awaiting_human') {
    return { needsAttention: true, attentionReason: 'Waiting for your approval' };
  }
  if (run?.status === 'failed') {
    return {
      needsAttention: true,
      attentionReason: run.error ? `Last run failed: ${firstLine(run.error)}` : 'Last run failed',
    };
  }
  if (run?.status === 'completed_with_errors') {
    return {
      needsAttention: true,
      attentionReason: run.error ? `Last run had errors: ${firstLine(run.error)}` : 'Last run finished with errors',
    };
  }
  if ((input.pendingFixes ?? 0) > 0) {
    return { needsAttention: true, attentionReason: 'A fix is waiting for you' };
  }
  return { needsAttention: false, attentionReason: null };
}

/** Needs-attention first, then most recently changed. */
export function sortWorkflowCards<T extends { needsAttention: boolean; updatedAt: string }>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

// ———————————————————————————————————————————— trigger

export type TriggerKindDTO = 'manual' | 'cron' | 'webhook' | 'event' | 'whatsapp' | 'gmail' | 'chat';

export interface TriggerDTO {
  kind: TriggerKindDTO;
  cron: string | null;
  timezone: string | null;
  enabled: boolean;
  description: string;
  nextRuns: string[];
  /** kind 'event' only: a catalogue type (GET /api/native/workflows/event-types), else null. */
  eventType: string | null;
  /** kind 'event' only: the payload filter, all clauses must hold. */
  filter: FilterClause[];
}

export interface TriggerInput {
  /** `workflows.trigger`. */
  row: Record<string, unknown> | null;
  /** The `trigger` node's config, if the canvas has one. */
  triggerNodeConfig: Record<string, unknown> | null;
  /** Rows of `workflow_schedules` for this workflow. */
  schedules: Array<{ type: string; config: unknown; enabled: boolean }>;
  nodeTypes: string[];
  /** Is a `chat` node wired as the workflow's entry (has outgoing edges)? */
  chatWired: boolean;
  /** Resolve a schedule config's zone — `cronTimezone`, injected so this stays pure. */
  resolveZone: (config: unknown) => string;
  now?: Date;
}

/** The next `count` fire times of a cron in a zone, ISO. Empty on an expression croner rejects. */
export function nextRuns(expr: string, timezone: string, count = 3, from?: Date): string[] {
  try {
    const job = new Cron(expr, { timezone, paused: true });
    const runs = job.nextRuns(count, from ?? new Date());
    job.stop();
    return runs.map((d) => d.toISOString());
  } catch {
    return [];
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * What starts this workflow, in the phone's terms.
 *
 * The inbox triggers are NODES (`whatsapp-trigger`, `gmail-trigger`) rather
 * than a `workflows.trigger` kind, and a wired `chat` node is an entry of its
 * own; everything else reads `workflows.trigger`. For a cron, the schedule ROW
 * is what the scheduler actually fires, so it wins over the trigger column and
 * the node mirror, and "enabled" means that row exists and is on — a cron in
 * the column with no row is written down but never runs.
 */
export function triggerDTO(input: TriggerInput): TriggerDTO {
  const row = input.row ?? {};
  const rowConfig = (row.config ?? {}) as Record<string, unknown>;
  const node = input.triggerNodeConfig ?? {};
  const types = new Set(input.nodeTypes);
  const rowType = str(row.type) ?? str(node.kind) ?? 'manual';

  let kind: TriggerKindDTO;
  if (types.has('whatsapp-trigger')) kind = 'whatsapp';
  else if (types.has('gmail-trigger')) kind = 'gmail';
  else if (rowType === 'cron' || rowType === 'webhook' || rowType === 'event') kind = rowType;
  else if (input.chatWired) kind = 'chat';
  else kind = 'manual';

  if (kind === 'cron') {
    const schedule = input.schedules.find((s) => s.type === 'cron');
    const scheduleConfig = (schedule?.config ?? {}) as Record<string, unknown>;
    const cron =
      str(scheduleConfig.expression) ??
      str(scheduleConfig.cron) ??
      str(row.cron) ??
      str(rowConfig.expression) ??
      str(rowConfig.cron) ??
      str(node.cron);
    const timezone = schedule
      ? input.resolveZone(scheduleConfig)
      : input.resolveZone({ timezone: row.timezone ?? rowConfig.timezone ?? node.timezone });
    const enabled = !!schedule && schedule.enabled;
    const when = cron ? describeCron(cron) : 'No schedule set';
    const zoned = cron && timezone !== DEFAULT_CRON_TZ ? `${when} (${timezone})` : when;
    return {
      kind,
      cron,
      timezone,
      enabled,
      description: enabled ? zoned : `Paused — ${zoned.charAt(0).toLowerCase()}${zoned.slice(1)}`,
      nextRuns: enabled && cron ? nextRuns(cron, timezone, 3, input.now) : [],
      eventType: null,
      filter: [],
    };
  }

  const nodeEnabled = node.enabled !== false;
  if (kind === 'event') {
    const schedule = input.schedules.find((s) => s.type === 'event');
    const scheduleConfig = (schedule?.config ?? {}) as Record<string, unknown>;
    const raw = str(scheduleConfig.eventType) ?? str(row.eventType) ?? str(rowConfig.eventType) ?? str(node.eventType);
    const entry = raw ? eventEntry(raw) : null;
    const parsed = normaliseFilter(scheduleConfig.filter ?? row.filter ?? node.filter);
    const filter = parsed.ok ? parsed.filter : [];
    const when = filter.map((c) => `${c.key} ${c.op === 'contains' ? 'contains' : 'is'} "${c.value}"`).join(' and ');
    return {
      kind,
      cron: null,
      timezone: null,
      enabled: !!schedule && schedule.enabled,
      description: `${entry ? `Runs on: ${entry.label}` : raw ? `Runs on the "${raw}" event` : 'Runs on an event'}${when ? `, where ${when}` : ''}`,
      nextRuns: [],
      eventType: entry?.type ?? raw,
      filter,
    };
  }

  const description: Record<Exclude<TriggerKindDTO, 'cron' | 'event'>, string> = {
    manual: 'Runs when you start it',
    webhook: 'Runs when its webhook is called',
    whatsapp: 'Runs when a WhatsApp message arrives',
    gmail: 'Runs when a matching email arrives',
    chat: 'Runs when you message its chat',
  };
  return {
    kind,
    cron: null,
    timezone: null,
    enabled: nodeEnabled,
    description: description[kind],
    nextRuns: [],
    eventType: null,
    filter: [],
  };
}
