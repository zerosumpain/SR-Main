// Row → wire. Pure, so the shapes the phone decodes are testable without a
// database. Every jsonb column is read defensively: a row written by an older
// build, or by hand, must still render rather than 500 the list.

import type { Capture, CaptureAction } from '$lib/db/schema';
import type {
  CaptureActionKind,
  CaptureActionState,
  CaptureActionView,
  CaptureEntity,
  CaptureFlowItem,
  CapturePlace,
  CaptureScreen,
  CaptureSpeaker,
  CaptureStatus,
  CaptureSummary,
  CaptureTurn,
  CaptureView,
} from './types';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function speakersOf(row: Pick<Capture, 'speakers'>): CaptureSpeaker[] {
  return arr<CaptureSpeaker>(row.speakers).filter((s) => s && typeof s.label === 'string');
}

/** The name to show for one speaker: confirmed, else a guess, else "You" for the recorder, else the label. */
export function speakerName(s: CaptureSpeaker): string {
  return s.confirmed?.name || s.guess?.name || (s.isOwner ? 'You' : s.label);
}

export function screenOf(row: Pick<Capture, 'screen'>): CaptureScreen | null {
  const s = row.screen as Partial<CaptureScreen> | null;
  if (!s || typeof s !== 'object') return null;
  return {
    app: s.app && typeof s.app.name === 'string' ? s.app : null,
    summary: typeof s.summary === 'string' ? s.summary : '',
    ocrText: typeof s.ocrText === 'string' ? s.ocrText : '',
    ...(typeof s.corrected === 'string' ? { corrected: s.corrected } : {}),
    ...(s.denied === true ? { denied: true } : {}),
  };
}

/** The app the capture was made over: the owner's correction beats the guess. */
export function appOf(row: Pick<Capture, 'screen' | 'intake'>): string | undefined {
  const s = screenOf(row);
  const hint = (row.intake as { appHint?: unknown } | null)?.appHint;
  return s?.corrected || s?.app?.name || (typeof hint === 'string' && hint ? hint : undefined);
}

/** A short window of text around the first match of `q`, else the opening. */
export function snippetOf(text: string, q?: string, width = 160): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const needle = (q ?? '').trim().toLowerCase();
  const at = needle ? t.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return t.length > width ? `${t.slice(0, width - 1)}…` : t;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(t.length, start + width);
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`;
}

export function toSummary(row: Capture, actionsOpen: number, q?: string): CaptureSummary {
  const app = appOf(row);
  return {
    id: row.id,
    title: row.title || 'Capture',
    startedAt: row.startedAt.toISOString(),
    durationS: row.durationS ?? null,
    status: row.status as CaptureStatus,
    ...(app ? { app } : {}),
    speakers: speakersOf(row).map(speakerName),
    actionsOpen,
    snippet: snippetOf(q ? `${row.title ?? ''} ${row.summary ?? ''} ${row.transcript}` : row.summary || row.transcript, q),
  };
}

export function toActionView(a: CaptureAction): CaptureActionView {
  return {
    id: a.id,
    captureId: a.captureId,
    kind: a.kind as CaptureActionKind,
    title: a.title,
    detail: a.detail,
    who: a.who,
    dueAt: iso(a.dueAt),
    params: (a.params ?? {}) as Record<string, unknown>,
    state: a.state as CaptureActionState,
    refKind: a.refKind,
    refId: a.refId,
    error: a.error,
    createdAt: a.createdAt.toISOString(),
    decidedAt: iso(a.decidedAt),
  };
}

export function toView(row: Capture, actions: CaptureAction[], origin: string): CaptureView {
  const base = `${origin}/api/native/captures/${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    spaceId: row.spaceId,
    startedAt: row.startedAt.toISOString(),
    endedAt: iso(row.endedAt),
    durationS: row.durationS ?? null,
    transcript: row.transcript,
    transcriptSource: row.transcriptSource === 'server' ? 'server' : 'phone',
    turns: arr<CaptureTurn>(row.turns),
    speakers: speakersOf(row),
    screen: screenOf(row),
    place: (row.place as CapturePlace | null) ?? null,
    title: row.title,
    summary: row.summary,
    flow: arr<CaptureFlowItem>(row.flow),
    entities: arr<CaptureEntity>(row.entities),
    status: row.status as CaptureStatus,
    error: row.error,
    // numeric comes back as a string; null stays null (unknown is not zero).
    analysisCostUsd: row.analysisCostUsd == null ? null : Number(row.analysisCostUsd),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    audioUrl: row.audioUploadId ? `${base}/audio` : null,
    screenUrl: row.screenUploadId ? `${base}/screen` : null,
    actions: actions.map(toActionView),
  };
}

/** What a capture says to the graph: the words, and who and what it was about. */
export function graphText(row: Capture): string {
  const speakers = speakersOf(row);
  const lines: string[] = [];
  if (row.title) lines.push(row.title);
  if (row.summary) lines.push(row.summary);
  if (speakers.length) {
    lines.push(
      `Speakers: ${speakers
        .map((s) => `${s.label} = ${speakerName(s)}${s.confirmed ? ' (confirmed)' : s.isOwner ? ' (the recorder)' : s.guess ? ' (a guess)' : ''}`)
        .join('; ')}`,
    );
  }
  const app = appOf(row);
  if (app) lines.push(`Recorded over: ${app}`);
  const place = row.place as CapturePlace | null;
  if (place?.name) lines.push(`Place: ${place.name}`);
  const turns = arr<CaptureTurn>(row.turns);
  const names = new Map(speakers.map((s) => [s.label, speakerName(s)]));
  lines.push('');
  if (turns.length) {
    for (const t of turns) lines.push(`${names.get(t.speaker) ?? t.speaker}: ${t.text}`);
  } else {
    lines.push(row.transcript);
  }
  return lines.join('\n').trim();
}
