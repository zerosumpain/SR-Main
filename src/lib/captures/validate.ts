// Validators for everything that crosses into a capture: the phone's POST
// body, the analysis model's reply, an action's params (the model's proposal
// and the owner's edit of it), the decision tap and the PATCH.
//
// Pure. Same rule as `$lib/daydream/notebook/actions`: a wrong TYPE is refused,
// never coerced, so a spelling mistake cannot become a confident wrong action.
// The one place that drops rather than refuses is the model's reply, where an
// unknown kind or an out-of-range confidence costs that one item, not the
// whole analysis (CONTRACT: "an unknown kind is dropped, and so is an
// out-of-range confidence").

import {
  CAPTURE_ACTION_KINDS,
  CAPTURE_ENTITY_TYPES,
  CAPTURE_SOURCES,
  MAX_ACTIONS,
  type CalendarActionParams,
  type CaptureActionKind,
  type CaptureActionParams,
  type CaptureAnalysis,
  type CaptureEntity,
  type CaptureEntityType,
  type CaptureFlowItem,
  type CaptureIntake,
  type CapturePlace,
  type CaptureSource,
  type CaptureSpeaker,
  type CaptureTurn,
  type FollowupActionParams,
  type ProposedAction,
  type RememberActionParams,
  type ResearchActionParams,
  type SpeakerConfirmation,
  type SpeakerGuess,
} from './types';

export const MAX_TRANSCRIPT_CHARS = 200_000;
export const MAX_TURNS = 4_000;
export const MAX_SPEAKERS = 12;
export const MAX_OCR_CHARS = 20_000;
const MAX_TITLE = 160;
const MAX_DETAIL = 1_000;
const MAX_SUMMARY = 2_000;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** An ISO-ish instant `Date.parse` understands, normalised to ISO. Null for anything else. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A speaker label as the phone writes them: `S1`, `S2`, … Short and boring on purpose. */
const LABEL = /^[A-Za-z0-9_-]{1,16}$/;

export function isCaptureActionKind(v: unknown): v is CaptureActionKind {
  return typeof v === 'string' && (CAPTURE_ACTION_KINDS as readonly string[]).includes(v);
}

// ── The phone's POST body ─────────────────────────────────────────────────

function parseTurns(raw: unknown): Result<CaptureTurn[]> {
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return fail('turns must be an array');
  if (raw.length > MAX_TURNS) return fail(`at most ${MAX_TURNS} turns`);
  const out: CaptureTurn[] = [];
  for (const t of raw) {
    if (!isObject(t)) return fail('each turn must be an object');
    if (typeof t.speaker !== 'string' || !LABEL.test(t.speaker)) return fail('turn.speaker must be a short label like S1');
    if (!finite(t.start) || !finite(t.end) || t.start < 0 || t.end < t.start) return fail('turn.start and turn.end must be seconds, end after start');
    if (typeof t.text !== 'string') return fail('turn.text must be a string');
    out.push({ speaker: t.speaker, start: t.start, end: t.end, text: t.text.slice(0, 10_000) });
  }
  return ok(out);
}

function parsePlace(raw: unknown): Result<CapturePlace | null> {
  if (raw === undefined || raw === null) return ok(null);
  if (!isObject(raw)) return fail('place must be an object');
  const { lat, lon } = raw;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail('place.lat and place.lon must be coordinates');
  const name = str(raw.name, 200);
  return ok(name ? { lat, lon, name } : { lat, lon });
}

export function parseCaptureIntake(raw: unknown): Result<CaptureIntake> {
  if (!isObject(raw)) return fail('The body must be a JSON object.');
  const startedAt = isoOrNull(raw.startedAt);
  if (!startedAt) return fail('startedAt must be an ISO date-time.');
  let endedAt: string | null = null;
  if (raw.endedAt !== undefined && raw.endedAt !== null) {
    endedAt = isoOrNull(raw.endedAt);
    if (!endedAt) return fail('endedAt must be an ISO date-time.');
    if (Date.parse(endedAt) < Date.parse(startedAt)) return fail('endedAt is before startedAt.');
  }
  if (raw.transcript !== undefined && typeof raw.transcript !== 'string') return fail('transcript must be a string.');
  const transcript = typeof raw.transcript === 'string' ? raw.transcript.trim() : '';
  if (transcript.length > MAX_TRANSCRIPT_CHARS) return fail(`The transcript is longer than ${MAX_TRANSCRIPT_CHARS} characters.`);
  const turns = parseTurns(raw.turns);
  if (!turns.ok) return turns;

  let speakerCount = 1;
  if (raw.speakerCount !== undefined && raw.speakerCount !== null) {
    if (!Number.isInteger(raw.speakerCount) || (raw.speakerCount as number) < 1 || (raw.speakerCount as number) > MAX_SPEAKERS) {
      return fail(`speakerCount must be a whole number from 1 to ${MAX_SPEAKERS}.`);
    }
    speakerCount = raw.speakerCount as number;
  }
  const labelsSeen = new Set(turns.value.map((t) => t.speaker));
  speakerCount = Math.max(speakerCount, Math.min(labelsSeen.size, MAX_SPEAKERS));

  let ownerSpeaker: string | null = null;
  if (raw.ownerSpeaker !== undefined && raw.ownerSpeaker !== null) {
    if (typeof raw.ownerSpeaker !== 'string' || !LABEL.test(raw.ownerSpeaker)) return fail('ownerSpeaker must be a speaker label.');
    ownerSpeaker = raw.ownerSpeaker;
  }

  let screen: CaptureIntake['screen'] = null;
  if (raw.screen !== undefined && raw.screen !== null) {
    if (!isObject(raw.screen)) return fail('screen must be an object.');
    if (raw.screen.ocrText !== undefined && typeof raw.screen.ocrText !== 'string') return fail('screen.ocrText must be a string.');
    if (raw.screen.denied !== undefined && typeof raw.screen.denied !== 'boolean') return fail('screen.denied must be true or false.');
    screen = {
      ocrText: str(raw.screen.ocrText, MAX_OCR_CHARS),
      appHint: str(raw.screen.appHint, 80) || null,
      denied: raw.screen.denied === true,
    };
  }

  const place = parsePlace(raw.place);
  if (!place.ok) return place;

  for (const key of ['audio', 'screenshot'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return fail(`${key} must be true or false.`);
  }
  const audio = raw.audio !== false;
  // A denied screenshot is never uploaded, whatever the flag says.
  const screenshot = raw.screenshot === true && !(screen?.denied ?? false);

  let source: CaptureSource = 'app';
  if (raw.source !== undefined && raw.source !== null) {
    if (typeof raw.source !== 'string' || !(CAPTURE_SOURCES as readonly string[]).includes(raw.source)) {
      return fail(`source must be one of ${CAPTURE_SOURCES.join(', ')}.`);
    }
    source = raw.source as CaptureSource;
  }

  if (!audio && !transcript) return fail('A capture needs audio or a transcript.');

  return ok({ startedAt, endedAt, transcript, turns: turns.value, speakerCount, ownerSpeaker, screen, place: place.value, audio, screenshot, source });
}

/** S1..Sn, plus any label the turns used, owner marked. The row's starting `speakers`. */
export function initialSpeakers(intake: Pick<CaptureIntake, 'turns' | 'speakerCount' | 'ownerSpeaker'>): CaptureSpeaker[] {
  const labels: string[] = [];
  for (const t of intake.turns) if (!labels.includes(t.speaker)) labels.push(t.speaker);
  for (let i = 1; labels.length < intake.speakerCount && i <= MAX_SPEAKERS + labels.length; i++) {
    if (!labels.includes(`S${i}`)) labels.push(`S${i}`);
  }
  if (intake.ownerSpeaker && !labels.includes(intake.ownerSpeaker)) labels.unshift(intake.ownerSpeaker);
  if (labels.length === 0) labels.push('S1');
  // One speaker and no owner label: a dictation, and the recorder is speaking.
  const owner = intake.ownerSpeaker ?? (labels.length === 1 ? labels[0] : null);
  return labels.slice(0, MAX_SPEAKERS).map((label) => ({ label, guess: null, confirmed: null, isOwner: label === owner }));
}

// ── Action params ─────────────────────────────────────────────────────────

/** The keys an action arrived with — keys only, never the private values. */
function describe(p: Record<string, unknown>): string {
  const keys = Object.keys(p ?? {});
  return keys.length ? `params with keys [${keys.join(', ')}]` : 'empty params';
}

export function validateActionParams(kind: CaptureActionKind, raw: unknown): Result<CaptureActionParams> {
  const p = isObject(raw) ? raw : {};
  if (raw !== undefined && raw !== null && !isObject(raw)) return fail('params must be an object');
  switch (kind) {
    case 'research': {
      const question = str(p.question, 300);
      if (question.length < 5) return fail(`research.question must be at least 5 characters — got ${describe(p)}`);
      return ok({ question } satisfies ResearchActionParams);
    }
    case 'calendar': {
      const title = str(p.title, MAX_TITLE);
      if (title.length < 2) return fail(`calendar.title is required — got ${describe(p)}`);
      const start = isoOrNull(p.start);
      if (!start) return fail('calendar.start must be an ISO date-time');
      const out: CalendarActionParams = { title, start };
      if (p.end !== undefined && p.end !== null) {
        const end = isoOrNull(p.end);
        if (!end || Date.parse(end) <= Date.parse(start)) return fail('calendar.end must be an ISO date-time after start');
        out.end = end;
      }
      const location = str(p.location, 300);
      if (location) out.location = location;
      if (p.attendees !== undefined && p.attendees !== null) {
        if (!Array.isArray(p.attendees) || p.attendees.some((a) => typeof a !== 'string')) return fail('calendar.attendees must be a list of names');
        const attendees = (p.attendees as string[]).map((a) => a.trim().slice(0, 120)).filter(Boolean).slice(0, 20);
        if (attendees.length) out.attendees = attendees;
      }
      const calendar = str(p.calendar, 500);
      if (calendar) out.calendar = calendar;
      return ok(out);
    }
    case 'followup': {
      const when = isoOrNull(p.when);
      if (!when) return fail(`followup.when must be an ISO date-time — got ${describe(p)}`);
      const message = str(p.message, MAX_DETAIL);
      if (message.length < 3) return fail('followup.message is required');
      return ok({ when, message } satisfies FollowupActionParams);
    }
    case 'remember': {
      const fact = str(p.fact, 2_000);
      if (fact.length < 5) return fail(`remember.fact must be at least 5 characters — got ${describe(p)}`);
      const entity = str(p.entity, 200);
      return ok(entity ? ({ fact, entity } satisfies RememberActionParams) : { fact });
    }
    case 'todo_me':
    case 'todo_other':
      // Their substance is the row's own title / detail / who / due_at.
      return ok({});
  }
}

/**
 * One proposed action, from the model or the owner. Refuses with a reason; the
 * analysis caller drops refused items and carries on.
 */
export function validateProposedAction(raw: unknown): Result<ProposedAction> {
  if (!isObject(raw)) return fail('action is not an object');
  if (!isCaptureActionKind(raw.kind)) return fail(`unknown action kind: ${String(raw.kind)}`);
  const kind = raw.kind;
  const title = str(raw.title, MAX_TITLE);
  if (title.length < 3) return fail('action needs a title of at least 3 characters');
  const detail = str(raw.detail, MAX_DETAIL) || null;
  const who = str(raw.who, 120) || null;
  if (kind === 'todo_other' && !who) return fail('todo_other needs who it is for');
  let dueAt: string | null = null;
  if (raw.dueAt !== undefined && raw.dueAt !== null && raw.dueAt !== '') {
    dueAt = isoOrNull(raw.dueAt);
    if (!dueAt) return fail('dueAt must be an ISO date-time');
  }
  const params = validateActionParams(kind, raw.params);
  if (!params.ok) return params;
  return ok({ kind, title, detail, who, dueAt, params: params.value });
}

// ── The analysis model's reply ────────────────────────────────────────────

function parseGuess(raw: unknown): SpeakerGuess | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name, 120);
  if (!name) return null;
  const c = raw.confidence;
  // Out of range is DROPPED, not clamped: a model that says 1.4 has not told us
  // how sure it is, and a clamp would turn that into "certain".
  if (!finite(c) || c < 0 || c > 1) return null;
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((e): e is string => typeof e === 'string').map((e) => e.trim().slice(0, 200)).filter(Boolean).slice(0, 6)
    : [];
  const entityId = str(raw.entityId, 120);
  return entityId ? { name, entityId, confidence: c, evidence } : { name, confidence: c, evidence };
}

function parseFlow(raw: unknown, labels: Set<string>): CaptureFlowItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptureFlowItem[] = [];
  for (const f of raw.slice(0, 40)) {
    if (!isObject(f)) continue;
    const topic = str(f.topic, 160);
    if (!topic || !finite(f.from_s) || !finite(f.to_s) || f.from_s < 0 || f.to_s < f.from_s) continue;
    const speakers = Array.isArray(f.speakers) ? f.speakers.filter((s): s is string => typeof s === 'string' && labels.has(s)) : [];
    out.push({ topic, from_s: f.from_s, to_s: f.to_s, speakers });
  }
  return out;
}

function parseEntities(raw: unknown): CaptureEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptureEntity[] = [];
  const seen = new Set<string>();
  for (const e of raw.slice(0, 60)) {
    if (!isObject(e)) continue;
    const name = str(e.name, 160);
    if (!name || typeof e.type !== 'string' || !(CAPTURE_ENTITY_TYPES as readonly string[]).includes(e.type)) continue;
    const key = `${e.type}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, type: e.type as CaptureEntityType, mention: str(e.mention, 300) });
  }
  return out;
}

/**
 * The model's JSON reply → what the analysis may write. Speakers are the row's
 * own (labels come from the phone, never the model); the model only fills each
 * one's guess. The owner's speaker is always the owner, whatever was guessed.
 */
export function validateAnalysis(
  raw: unknown,
  speakers: CaptureSpeaker[],
  ownerName: string,
): { analysis: CaptureAnalysis; dropped: string[] } {
  const o = isObject(raw) ? raw : {};
  const dropped: string[] = [];
  const labels = new Set(speakers.map((s) => s.label));

  const guesses = new Map<string, SpeakerGuess | null>();
  if (Array.isArray(o.speakers)) {
    for (const s of o.speakers) {
      if (!isObject(s) || typeof s.label !== 'string' || !labels.has(s.label)) continue;
      const g = parseGuess(s.guess ?? s);
      if (!g && s.guess !== null && s.guess !== undefined) dropped.push(`speaker ${s.label}: guess out of range`);
      guesses.set(s.label, g);
    }
  }
  const nextSpeakers: CaptureSpeaker[] = speakers.map((s) => {
    if (s.isOwner) {
      return { ...s, guess: { name: ownerName, confidence: 1, evidence: ['the recorder'] } };
    }
    return { ...s, guess: guesses.has(s.label) ? guesses.get(s.label)! : s.guess };
  });

  const actions: ProposedAction[] = [];
  if (Array.isArray(o.actions)) {
    for (const a of o.actions) {
      if (actions.length >= MAX_ACTIONS) {
        dropped.push('action: over the limit');
        continue;
      }
      const v = validateProposedAction(a);
      if (v.ok) actions.push(v.value);
      else dropped.push(`action: ${v.error}`);
    }
  }

  return {
    analysis: {
      title: str(o.title, MAX_TITLE) || 'Capture',
      summary: str(o.summary, MAX_SUMMARY),
      flow: parseFlow(o.flow, labels),
      entities: parseEntities(o.entities),
      speakers: nextSpeakers,
      actions,
    },
    dropped,
  };
}

/** The vision pass's reply: `{app:{name, confidence}, summary}`. Out of range is dropped. */
export function validateScreenReply(raw: unknown): { app: { name: string; confidence: number } | null; summary: string } {
  const o = isObject(raw) ? raw : {};
  let app: { name: string; confidence: number } | null = null;
  if (isObject(o.app)) {
    const name = str(o.app.name, 80);
    const c = o.app.confidence;
    if (name && finite(c) && c >= 0 && c <= 1) app = { name, confidence: c };
  }
  return { app, summary: str(o.summary, 600) };
}

// ── The owner's taps ──────────────────────────────────────────────────────

export interface DecisionBody {
  decision: 'approve' | 'dismiss';
  params?: Record<string, unknown>;
}

export function parseDecision(raw: unknown): Result<DecisionBody> {
  if (!isObject(raw)) return fail('The body must be a JSON object.');
  if (raw.decision !== 'approve' && raw.decision !== 'dismiss') return fail('decision must be approve or dismiss.');
  if (raw.params !== undefined && raw.params !== null && !isObject(raw.params)) return fail('params must be an object.');
  return ok({ decision: raw.decision, ...(isObject(raw.params) ? { params: raw.params } : {}) });
}

export interface CapturePatch {
  title?: string;
  speakers?: Array<{ label: string; confirmed: SpeakerConfirmation | null }>;
  screenApp?: string;
}

export function parsePatch(raw: unknown): Result<CapturePatch> {
  if (!isObject(raw)) return fail('The body must be a JSON object.');
  const out: CapturePatch = {};
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || !raw.title.trim()) return fail('title must be a non-empty string.');
    out.title = raw.title.trim().slice(0, MAX_TITLE);
  }
  if (raw.speakers !== undefined) {
    if (!Array.isArray(raw.speakers) || raw.speakers.length > MAX_SPEAKERS) return fail('speakers must be a list.');
    out.speakers = [];
    for (const s of raw.speakers) {
      if (!isObject(s) || typeof s.label !== 'string' || !LABEL.test(s.label)) return fail('each speaker needs its label.');
      if (s.confirmed === null) {
        out.speakers.push({ label: s.label, confirmed: null });
        continue;
      }
      if (!isObject(s.confirmed)) return fail('speaker.confirmed must be {name, entityId?} or null.');
      const name = str(s.confirmed.name, 120);
      if (!name) return fail('speaker.confirmed.name is required.');
      if (s.confirmed.entityId !== undefined && typeof s.confirmed.entityId !== 'string') return fail('speaker.confirmed.entityId must be a string.');
      const entityId = str(s.confirmed.entityId, 120);
      out.speakers.push({ label: s.label, confirmed: entityId ? { name, entityId } : { name } });
    }
  }
  if (raw.screenApp !== undefined) {
    if (typeof raw.screenApp !== 'string' || !raw.screenApp.trim()) return fail('screenApp must be a non-empty string.');
    out.screenApp = raw.screenApp.trim().slice(0, 80);
  }
  if (out.title === undefined && out.speakers === undefined && out.screenApp === undefined) return fail('Nothing to change.');
  return ok(out);
}
