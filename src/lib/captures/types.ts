// The shapes of a capture, on the wire and in the row's jsonb columns.
//
// Pure: no database, no server imports — the validators, the prompt and the
// tests all read these. The binding description is the captures CONTRACT.md
// (phone ⇄ SR-Main ⇄ SR-Jkai-Core); a field renamed here is a field the phone
// stops decoding.

/**
 * What a follow-up can BE. A closed list, the notebook-actions pattern: the
 * model proposes rows of these kinds as data, and each kind is a capability
 * the owner grants one tap at a time. Widening it is a decision, not a refactor.
 */
export const CAPTURE_ACTION_KINDS = ['todo_me', 'todo_other', 'research', 'calendar', 'followup', 'remember'] as const;
export type CaptureActionKind = (typeof CAPTURE_ACTION_KINDS)[number];

export const CAPTURE_ACTION_STATES = ['proposed', 'approved', 'dismissed', 'done', 'failed', 'refused'] as const;
export type CaptureActionState = (typeof CAPTURE_ACTION_STATES)[number];

export const CAPTURE_STATUSES = ['received', 'analysing', 'ready', 'failed'] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CAPTURE_ENTITY_TYPES = ['person', 'place', 'org', 'object', 'event', 'topic'] as const;
export type CaptureEntityType = (typeof CAPTURE_ENTITY_TYPES)[number];

export const CAPTURE_SOURCES = ['button', 'app', 'shortcut'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export interface CaptureTurn {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface SpeakerGuess {
  name: string;
  entityId?: string;
  /** 0..1 */
  confidence: number;
  evidence: string[];
}

export interface SpeakerConfirmation {
  name: string;
  entityId?: string;
}

export interface CaptureSpeaker {
  label: string;
  guess: SpeakerGuess | null;
  confirmed: SpeakerConfirmation | null;
  isOwner: boolean;
}

export interface CaptureScreen {
  app: { name: string; confidence: number } | null;
  summary: string;
  ocrText: string;
  /** The owner's one-tap correction of the app name. */
  corrected?: string;
  /** The phone's deny list matched: no image was uploaded or sent to a model. */
  denied?: boolean;
}

export interface CapturePlace {
  lat: number;
  lon: number;
  name?: string;
}

export interface CaptureFlowItem {
  topic: string;
  from_s: number;
  to_s: number;
  speakers: string[];
}

export interface CaptureEntity {
  name: string;
  type: CaptureEntityType;
  mention: string;
}

export interface ResearchActionParams {
  question: string;
}
export interface CalendarActionParams {
  title: string;
  start: string;
  end?: string;
  location?: string;
  attendees?: string[];
  /** Which of the owner's calendars. Absent: the calendar chosen once for jkai's diary entries. */
  calendar?: string;
}
export interface FollowupActionParams {
  when: string;
  message: string;
}
export interface RememberActionParams {
  fact: string;
  entity?: string;
}
/** `todo_other` keeps the draft it made here once done. Never sent. */
export interface TodoParams {
  draft?: string;
}

export type CaptureActionParams =
  | ResearchActionParams
  | CalendarActionParams
  | FollowupActionParams
  | RememberActionParams
  | TodoParams;

/** One validated follow-up, before it has a row. */
export interface ProposedAction {
  kind: CaptureActionKind;
  title: string;
  detail: string | null;
  who: string | null;
  dueAt: string | null;
  params: CaptureActionParams;
}

/** The POST /api/native/captures body, validated. */
export interface CaptureIntake {
  startedAt: string;
  endedAt: string | null;
  transcript: string;
  turns: CaptureTurn[];
  speakerCount: number;
  ownerSpeaker: string | null;
  screen: { ocrText: string; appHint: string | null; denied: boolean } | null;
  place: CapturePlace | null;
  audio: boolean;
  screenshot: boolean;
  source: CaptureSource;
}

/** What the analysis pass is allowed to write, validated. */
export interface CaptureAnalysis {
  title: string;
  summary: string;
  flow: CaptureFlowItem[];
  entities: CaptureEntity[];
  speakers: CaptureSpeaker[];
  actions: ProposedAction[];
}

/** The wire shape of one action. */
export interface CaptureActionView {
  id: string;
  captureId: string;
  kind: CaptureActionKind;
  title: string;
  detail: string | null;
  who: string | null;
  dueAt: string | null;
  params: Record<string, unknown>;
  state: CaptureActionState;
  refKind: string | null;
  refId: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** The list row. */
export interface CaptureSummary {
  id: string;
  title: string;
  startedAt: string;
  durationS: number | null;
  status: CaptureStatus;
  app?: string;
  speakers: string[];
  actionsOpen: number;
  snippet: string;
}

/** The detail view: the full row, its actions, and where to fetch the media. */
export interface CaptureView {
  id: string;
  spaceId: string;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  transcript: string;
  transcriptSource: 'phone' | 'server';
  turns: CaptureTurn[];
  speakers: CaptureSpeaker[];
  screen: CaptureScreen | null;
  place: CapturePlace | null;
  title: string | null;
  summary: string | null;
  flow: CaptureFlowItem[];
  entities: CaptureEntity[];
  status: CaptureStatus;
  error: string | null;
  analysisCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
  audioUrl: string | null;
  screenUrl: string | null;
  actions: CaptureActionView[];
}

/** Upload caps. Audio is AAC from the phone; a screenshot is one JPEG. */
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
export const MAX_SCREEN_BYTES = 8 * 1024 * 1024;
/** At most this many follow-ups survive from one analysis. */
export const MAX_ACTIONS = 12;
