export const ACTIVITY_EVENT_SCHEMA_VERSION = 1 as const;

export const EVIDENCE_MODES = [
  'provider_event',
  'provider_snapshot',
  'inferred_delta',
  'archive_import',
  'device_observation',
] as const;

export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export const ACTIVITY_DATA_CLASSES = [
  'metadata',
  'activity',
  'raw_content',
  'location',
] as const;

export type ActivityDataClass = (typeof ACTIVITY_DATA_CLASSES)[number];

export interface ActivityActor {
  providerId?: string;
  label?: string;
}

export interface ActivityObject {
  providerId?: string;
  kind: string;
  label?: string;
  url?: string;
}

export type ActivityMeasure = string | number | boolean | null;

export interface ActivityProvenance {
  providerObjectId?: string;
  providerRevision?: string;
  importId?: string;
  derivedFromEventIds?: string[];
  adapterVersion: string;
}

export interface ActivityEventV1 {
  id: string;
  schemaVersion: typeof ACTIVITY_EVENT_SCHEMA_VERSION;
  principalId: string;
  connectionId: string;
  source: string;
  type: string;
  category: string;
  subjectKey: string;
  occurredAt: string | null;
  observedAt: string;
  evidenceMode: EvidenceMode;
  actor: ActivityActor;
  object: ActivityObject;
  measures: Record<string, ActivityMeasure>;
  provenance: ActivityProvenance;
}

export interface ActivityValidationContext {
  principalId?: string;
  connectionId?: string;
  /** Provider clocks may be a little ahead; larger future claims are rejected. */
  maxClockSkewMs?: number;
}

export class ActivityContractError extends Error {
  constructor(
    readonly code:
      | 'invalid_event'
      | 'principal_mismatch'
      | 'connection_mismatch'
      | 'invalid_time'
      | 'unsupported_claim'
      | 'raw_content_in_metadata',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityContractError';
  }
}

const EVENT_TYPE_RE = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/;
const TOKEN_RE = /^[a-z][a-z0-9_-]*$/;
const DEFAULT_MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * Fields that would smuggle provider prose through the metadata/activity
 * projection. Raw source text belongs in the separately encrypted source
 * object and requires a raw_content grant.
 */
const RAW_MEASURE_KEYS = new Set([
  'body',
  'comment_body',
  'content',
  'raw',
  'raw_text',
  'selftext',
  'text',
]);

/** Claims a recent-list snapshot cannot establish about a person's action. */
const SNAPSHOT_ACTION_KEYS = new Set([
  'activity_duration_seconds',
  'completed',
  'completion_percent',
  'listened_seconds',
  'played_seconds',
  'session_minutes',
]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ActivityContractError('invalid_event', `${field} must be a non-empty string`);
  }
  return value;
}

function parseTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ActivityContractError('invalid_time', `${field} must be an ISO date-time`);
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a canonical event at the ingestion boundary.
 *
 * This deliberately returns the same object: adapters and the store share one
 * wire contract, while validation remains pure and cheap enough to run for
 * every record and in fixture tests.
 */
export function validateActivityEvent(
  input: ActivityEventV1,
  context: ActivityValidationContext = {},
): ActivityEventV1 {
  if (!isPlainObject(input)) {
    throw new ActivityContractError('invalid_event', 'event must be an object');
  }
  if (input.schemaVersion !== ACTIVITY_EVENT_SCHEMA_VERSION) {
    throw new ActivityContractError(
      'invalid_event',
      `schemaVersion must be ${ACTIVITY_EVENT_SCHEMA_VERSION}`,
    );
  }

  requiredString(input.id, 'id');
  requiredString(input.principalId, 'principalId');
  requiredString(input.connectionId, 'connectionId');
  requiredString(input.subjectKey, 'subjectKey');
  requiredString(input.provenance?.adapterVersion, 'provenance.adapterVersion');
  requiredString(input.object?.kind, 'object.kind');

  if (!TOKEN_RE.test(input.source)) {
    throw new ActivityContractError('invalid_event', 'source must be a lowercase token');
  }
  if (!TOKEN_RE.test(input.category)) {
    throw new ActivityContractError('invalid_event', 'category must be a lowercase token');
  }
  if (!EVENT_TYPE_RE.test(input.type)) {
    throw new ActivityContractError('invalid_event', 'type must be a dotted lowercase event name');
  }
  if (!EVIDENCE_MODES.includes(input.evidenceMode)) {
    throw new ActivityContractError('invalid_event', 'evidenceMode is not supported');
  }
  if (!isPlainObject(input.actor) || !isPlainObject(input.object)) {
    throw new ActivityContractError('invalid_event', 'actor and object must be objects');
  }
  if (!isPlainObject(input.measures) || !isPlainObject(input.provenance)) {
    throw new ActivityContractError('invalid_event', 'measures and provenance must be objects');
  }

  if (context.principalId && input.principalId !== context.principalId) {
    throw new ActivityContractError('principal_mismatch', 'event principal does not own connection');
  }
  if (context.connectionId && input.connectionId !== context.connectionId) {
    throw new ActivityContractError('connection_mismatch', 'event connection does not match sync');
  }

  const observedAt = parseTime(input.observedAt, 'observedAt');
  if (input.occurredAt !== null) {
    const occurredAt = parseTime(input.occurredAt, 'occurredAt');
    const maxClockSkewMs = context.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
    if (occurredAt > observedAt + maxClockSkewMs) {
      throw new ActivityContractError('invalid_time', 'occurredAt is implausibly after observedAt');
    }
  }

  for (const [key, value] of Object.entries(input.measures)) {
    if (!TOKEN_RE.test(key)) {
      throw new ActivityContractError('invalid_event', `measure key ${key} is not a token`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ActivityContractError('invalid_event', `measure ${key} must be finite`);
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new ActivityContractError('invalid_event', `measure ${key} must be scalar`);
    }
    if (RAW_MEASURE_KEYS.has(key)) {
      throw new ActivityContractError(
        'raw_content_in_metadata',
        `raw content field ${key} must be stored outside the event envelope`,
      );
    }
    if (input.evidenceMode === 'provider_snapshot' && SNAPSHOT_ACTION_KEYS.has(key)) {
      throw new ActivityContractError(
        'unsupported_claim',
        `provider snapshot cannot establish ${key}`,
      );
    }
  }

  if (input.evidenceMode === 'provider_snapshot' && input.occurredAt !== null) {
    throw new ActivityContractError(
      'unsupported_claim',
      'provider snapshot must not claim an occurrence time',
    );
  }

  return input;
}
