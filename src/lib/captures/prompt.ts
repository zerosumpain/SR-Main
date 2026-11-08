// The analysis pass's prompt, and reading its reply. Pure.
//
// One structured call per capture (PLAN "Cost"): the model fills the title,
// summary, conversation flow, entities, speaker guesses and up to twelve
// follow-ups from the closed list, as JSON. Everything it returns goes through
// `validateAnalysis` before a row is touched.

import { CAPTURE_ACTION_KINDS, CAPTURE_ENTITY_TYPES, MAX_ACTIONS, type CaptureSpeaker, type CaptureTurn } from './types';

export interface PromptInput {
  ownerName: string;
  startedAt: string;
  endedAt: string | null;
  transcript: string;
  turns: CaptureTurn[];
  speakers: CaptureSpeaker[];
  calendar: Array<{ title: string; start: string; end: string | null; location: string | null }>;
  screen: { app: string | null; ocrText: string; summary: string } | null;
  place: { lat: number; lon: number; name?: string } | null;
}

/** Long enough for an hour's conversation; the cut is marked, never silent. */
const MAX_PROMPT_TRANSCRIPT = 60_000;
const MAX_PROMPT_OCR = 3_000;

export const ANALYSIS_SYSTEM = `You analyse a recording the owner made on his phone: a dictation, or a conversation with other people.
Reply with ONE JSON object and nothing else:
{
  "title": "short title, under 80 characters",
  "summary": "two to four sentences",
  "flow": [{"topic": "...", "from_s": 0, "to_s": 42, "speakers": ["S1"]}],
  "entities": [{"name": "...", "type": "${CAPTURE_ENTITY_TYPES.join('|')}", "mention": "the words that named it"}],
  "speakers": [{"label": "S2", "guess": {"name": "...", "confidence": 0.0-1.0, "evidence": ["named twice", "calendar attendee"]} | null}],
  "actions": [{"kind": "${CAPTURE_ACTION_KINDS.join('|')}", "title": "...", "detail": "...", "who": "for todo_other: the person", "dueAt": "ISO or null", "params": {...}}]
}
Action kinds and their params:
- todo_me: something the owner said he would do. params {}.
- todo_other: something someone else should do; "who" names them. params {}.
- research: a question worth looking into. params {"question": "..."}.
- calendar: a meeting or event with a time. params {"title", "start": ISO, "end"?: ISO, "location"?, "attendees"?: [names]}.
- followup: a reminder to check back. params {"when": ISO, "message": "..."}.
- remember: a fact worth keeping. params {"fact": "...", "entity"?: "who or what it is about"}.
Rules:
- At most ${MAX_ACTIONS} actions, only ones the recording actually supports. None is a fine answer.
- Speaker guesses are guesses: give evidence and an honest confidence. Use null when there is nothing to go on. Never guess the owner's speaker; it is the owner.
- Dates are ISO 8601 with a timezone offset, resolved against the recording time (Europe/London).
- Use only what is in the input. Do not invent names, times or facts.`;

export function analysisPrompt(input: PromptInput): string {
  const cut = input.transcript.length > MAX_PROMPT_TRANSCRIPT;
  const parts: string[] = [];
  parts.push(`Recorded: ${input.startedAt}${input.endedAt ? ` to ${input.endedAt}` : ''} (store times as ISO).`);
  parts.push(`The owner is ${input.ownerName}.`);
  parts.push(
    `Speakers: ${input.speakers
      .map((s) => `${s.label}${s.isOwner ? ' (the owner)' : ''}${s.confirmed ? ` (confirmed: ${s.confirmed.name})` : ''}`)
      .join(', ')}`,
  );
  if (input.calendar.length) {
    parts.push('Calendar events around the time:');
    for (const e of input.calendar.slice(0, 10)) {
      parts.push(`- ${e.title} (${e.start}${e.end ? ` to ${e.end}` : ''}${e.location ? `, ${e.location}` : ''})`);
    }
  }
  if (input.place) parts.push(`Place: ${input.place.name ?? `${input.place.lat.toFixed(4)}, ${input.place.lon.toFixed(4)}`}`);
  if (input.screen) {
    if (input.screen.app) parts.push(`On screen: ${input.screen.app}`);
    if (input.screen.summary) parts.push(`Screen summary: ${input.screen.summary}`);
    if (input.screen.ocrText) parts.push(`Screen text:\n${input.screen.ocrText.slice(0, MAX_PROMPT_OCR)}`);
  }
  parts.push('');
  if (input.turns.length) {
    parts.push('Transcript by speaker (seconds from the start):');
    let used = 0;
    for (const t of input.turns) {
      const line = `[${t.start.toFixed(0)}s ${t.speaker}] ${t.text}`;
      used += line.length;
      if (used > MAX_PROMPT_TRANSCRIPT) {
        parts.push('[transcript cut here for length]');
        break;
      }
      parts.push(line);
    }
  } else {
    parts.push('Transcript:');
    parts.push(input.transcript.slice(0, MAX_PROMPT_TRANSCRIPT));
    if (cut) parts.push('[transcript cut here for length]');
  }
  return parts.join('\n');
}

export const SCREEN_SYSTEM = `You see one screenshot from an iPhone, taken the moment the owner started a recording.
Reply with ONE JSON object: {"app": {"name": "the app in front, e.g. WhatsApp, Safari (bbc.co.uk), Mail", "confidence": 0.0-1.0}, "summary": "one sentence on what the screen shows"}.
Name the app from its chrome, logo and title. Do not transcribe private messages, numbers or passwords into the summary.`;

/** The first JSON object in a reply, tolerating code fences and prose around it. */
export function parseJsonReply(text: string): unknown {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
