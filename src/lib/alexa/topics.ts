// Topic tagging — the prompt and the parse. Pure; the model call is in topics.server.ts.

import { VOICE_TOPICS, isVoiceTopic, type VoiceTopic } from './types';

export interface TopicInput {
  id: string;
  command: string;
  reply: string | null;
  intent: string | null;
}

export const TOPIC_SYSTEM = `You label things people said to an Alexa smart speaker in a family home.
For each numbered line, pick exactly one topic from this list:
${VOICE_TOPICS.join(', ')}

Guidance: "timers-alarms" includes reminders; "questions" is general knowledge, spelling, maths and facts; "smart-home" is lights, heating, plugs and routines; "tv-video" is Fire TV and video apps; "jokes-chat" is jokes, games, greetings and small talk; "other" when nothing fits.
Return JSON only: an array of {"n": <line number>, "topic": "<topic>"}, one per line, no prose.`;

/** Numbered lines the model labels. Replies are clipped: the command carries the topic. */
export function topicPrompt(rows: readonly TopicInput[]): string {
  return rows
    .map((r, i) => {
      const reply = r.reply ? ` → ${r.reply.slice(0, 120)}` : '';
      const intent = r.intent ? ` [${r.intent}]` : '';
      return `${i + 1}. ${r.command.slice(0, 200)}${intent}${reply}`;
    })
    .join('\n');
}

/**
 * The model's answer → id → topic. Anything off-vocabulary, out of range or
 * unparseable is left out, so the row stays untagged and is retried next run
 * rather than being filed under a made-up topic.
 */
export function parseTopicReply(raw: string, rows: readonly TopicInput[]): Map<string, VoiceTopic> {
  const out = new Map<string, VoiceTopic>();
  const body = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start < 0 || end <= start) return out;
    try {
      parsed = JSON.parse(body.slice(start, end + 1));
    } catch {
      return out;
    }
  }
  if (!Array.isArray(parsed)) return out;
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const n = Number((item as { n?: unknown }).n);
    const topic = String((item as { topic?: unknown }).topic ?? '').trim().toLowerCase();
    const row = Number.isInteger(n) ? rows[n - 1] : undefined;
    if (row && isVoiceTopic(topic)) out.set(row.id, topic);
  }
  return out;
}
