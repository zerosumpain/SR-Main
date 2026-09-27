// The shapes Main hands SR-Jkai-Core through the intel outbox.
//
// Main no longer writes intel rows itself: it describes the work and Core does
// it (docs: SR-Jkai-Core `docs/specs/2026-09-27-intel-basics.md`, "Outbox
// contract"). These types are copies of Core's `auto-extract` / `extract`
// inputs, in their JSON form — a Date crosses the table as an ISO string.
// Pure types and one constant: nothing here touches the database.

/** Which pipeline ingested something. `intel_notes.metadata.autoKind`. */
export type AutoKind = 'file' | 'research' | 'chat' | 'daydream' | 'note';

export interface ExtractedEntity {
  name: string;
  mentionId?: string;
  mention?: { text: string; start?: number; end?: number; context?: string };
  type: string;
  confidence: 'high' | 'medium' | 'low';
  properties: Record<string, unknown>;
  possibleMatchId: string | null;
}

export interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractedTimelineEvent {
  date: string;
  dateEnd?: string;
  type: 'deadline' | 'milestone' | 'event' | 'decision';
  title: string;
  description?: string;
  linkedEntity?: string;
}

export interface ProposedNewType {
  name: string;
  description: string;
  icon: string;
}

/** A pre-built extraction: Core persists it instead of running its extractor. */
export interface ExtractionResult {
  summary: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  timelineEvents: ExtractedTimelineEvent[];
  proposedNewTypes: ProposedNewType[];
}

/** The `extract` job's payload: Core's `extractIntoIntel` input, as JSON. */
export interface ExtractJob {
  kind: AutoKind;
  /** Whose intel this is. Every writer decides; there is no default. */
  spaceId: string;
  /** Stable id of the upstream row (research session id, notebook note id). */
  refId: string;
  title: string;
  text: string;
  /** Changes when the upstream content changes; Core skips re-extraction when equal. */
  contentHash: string;
  metadata?: Record<string, unknown>;
  /** `intel_notes.source`, when it differs from `kind`. */
  source?: string;
  categories?: string[];
  /** When the thing described happened, ISO 8601. */
  observedAt?: string;
  /** Re-extract even when the content hash matches. */
  force?: boolean;
  /** Persist this structure instead of running the extractor over `text`. */
  extraction?: ExtractionResult;
}

/** What Core writes back onto an `extract` row. */
export interface ExtractJobResult {
  status: 'extracted' | 'held' | 'unchanged' | 'disabled' | 'too-short' | 'skipped' | 'failed';
  noteId: string | null;
  entityCount: number;
}

/** The `note` job's payload: a note to create, and optionally process. */
export interface NoteJob {
  title?: string;
  content: string;
  /** `intel_notes.source`: 'news', 'web', … */
  source: string;
  spaceId: string;
  metadata?: Record<string, unknown>;
  /** Run extraction on it after creating it. */
  process?: boolean;
}

/** The `file-changed` job's payload. Core resolves the file's space and folder policy itself. */
export interface FileChangedJob {
  kind: 'file';
  refId: string;
  title: string;
  text: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

/**
 * Below this there is nothing worth an extraction. Core applies the same floor;
 * a caller that can check first saves itself a job that would only come back
 * `too-short`.
 */
export const MIN_EXTRACT_CHARS = 200;
